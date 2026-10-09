//! Asks the person in the app. A question goes to the interface as an `api://event` of kind `question`.
//! The request waits until App permissions' dialog answers through `api_call("decide")`.
//! Two minutes with no answer counts as no. Questions that arrive while the window is closed wait the same way and are listed again
//! when the interface asks for `pending`.

use std::{
    collections::HashMap,
    sync::{mpsc, Arc, Mutex, PoisonError},
};

use opennote_api::{
    backend::{ApprovalRequest, Approver, Decision},
    routes::APPROVAL_WAIT,
};
use serde_json::json;

/// Where questions go: the interface's event channel in the app, a closure in tests.
pub type Ask = Arc<dyn Fn(&ApprovalRequest) + Send + Sync>;

#[derive(Default)]
struct Waiting {
    answers: HashMap<String, mpsc::Sender<Decision>>,
    questions: Vec<ApprovalRequest>,
}

type HideFn = Arc<dyn Fn(&str) + Send + Sync>;

/// The app's approver.
pub struct AppApprover {
    waiting: Mutex<Waiting>,
    show: Mutex<Option<Ask>>,
    hide: Mutex<Option<HideFn>>,
}

impl Default for AppApprover {
    fn default() -> AppApprover {
        AppApprover {
            waiting: Mutex::default(),
            show: Mutex::new(None),
            hide: Mutex::new(None),
        }
    }
}

impl AppApprover {
    /// Sends questions, and the IDs of questions that no longer wait, through these.
    pub fn connect(&self, show: Ask, hide: Arc<dyn Fn(&str) + Send + Sync>) {
        *self.show.lock().unwrap_or_else(PoisonError::into_inner) = Some(show);
        *self.hide.lock().unwrap_or_else(PoisonError::into_inner) = Some(hide);
    }

    /// The questions waiting for an answer.
    pub fn pending(&self) -> Vec<ApprovalRequest> {
        self.waiting
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .questions
            .clone()
    }

    /// The person's answer. Returns false when the question no longer waits.
    pub fn decide(&self, id: &str, decision: Decision) -> bool {
        let sender = self
            .waiting
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .answers
            .remove(id);
        sender.is_some_and(|sender| sender.send(decision).is_ok())
    }

    fn forget(&self, id: &str) {
        let mut waiting = self.waiting.lock().unwrap_or_else(PoisonError::into_inner);
        waiting.answers.remove(id);
        waiting.questions.retain(|question| question.id != id);
        drop(waiting);
        if let Some(hide) = self.hide.lock().unwrap_or_else(PoisonError::into_inner).clone() {
            hide(id);
        }
    }
}

impl Approver for AppApprover {
    fn ask(&self, request: ApprovalRequest) -> Decision {
        let (sender, receiver) = mpsc::channel();
        {
            let mut waiting = self.waiting.lock().unwrap_or_else(PoisonError::into_inner);
            waiting.answers.insert(request.id.clone(), sender);
            waiting.questions.push(request.clone());
        }
        let show = self.show.lock().unwrap_or_else(PoisonError::into_inner).clone();
        let Some(show) = show else {
            self.forget(&request.id);
            return Decision::Deny;
        };
        show(&request);
        let decision = receiver.recv_timeout(APPROVAL_WAIT).unwrap_or(Decision::Deny);
        self.forget(&request.id);
        decision
    }
}

/// The event that shows a question.
pub fn question_event(request: &ApprovalRequest) -> serde_json::Value {
    json!({ "kind": "question", "request": request })
}

#[cfg(test)]
mod tests {
    use std::thread;

    use opennote_api::{backend::Question, Access, AppKind};

    use super::*;

    fn question(id: &str) -> ApprovalRequest {
        ApprovalRequest {
            id: id.into(),
            app_name: "opennote".into(),
            question: Question::Connect {
                app_kind: AppKind::Cli,
                wants: Access::Read,
            },
        }
    }

    #[test]
    fn a_question_waits_for_the_persons_answer() {
        let approver = Arc::new(AppApprover::default());
        let shown = Arc::new(Mutex::new(Vec::new()));
        let hidden = Arc::new(Mutex::new(Vec::new()));
        {
            let (shown, hidden) = (shown.clone(), hidden.clone());
            approver.connect(
                Arc::new(move |request| shown.lock().expect("lock").push(request.id.clone())),
                Arc::new(move |id| hidden.lock().expect("lock").push(id.to_owned())),
            );
        }
        let asking = {
            let approver = approver.clone();
            thread::spawn(move || approver.ask(question("q1")))
        };
        while approver.pending().is_empty() {
            thread::yield_now();
        }
        assert!(!approver.decide("other", Decision::Deny));
        assert!(approver.decide(
            "q1",
            Decision::Allow {
                access: None,
                notebooks: None,
                always: false
            }
        ));
        assert!(matches!(asking.join().expect("answers"), Decision::Allow { .. }));
        assert_eq!(*shown.lock().expect("lock"), ["q1"]);
        assert_eq!(*hidden.lock().expect("lock"), ["q1"]);
        assert!(approver.pending().is_empty());
    }

    #[test]
    fn without_a_window_the_answer_is_no() {
        let approver = AppApprover::default();
        assert_eq!(approver.ask(question("q2")), Decision::Deny);
        assert!(approver.pending().is_empty());
    }
}
