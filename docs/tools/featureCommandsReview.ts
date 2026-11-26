// The sentences of the comments and suggestions commands (Beta 12 text:review), kept here so featureCommands.ts
// stays under its size limit.

export const REVIEW_TEXT: Readonly<Record<string, string>> = {
  'text.review.newComment': 'Comments on the selected text, or on the word at the caret.',
  'text.review.showComments': "Shows or hides the comments pane, with the page's comments in reading order.",
  'text.review.previousComment': 'Goes to the comment before the caret.',
  'text.review.nextComment': 'Goes to the comment after the caret.',
  'text.review.resolveComment': 'Marks the comment at the caret as resolved.',
  'text.review.reopenComment': 'Opens a resolved comment again.',
  'text.review.deleteComment': 'Deletes the comment at the caret and its replies.',
  'text.review.trackChanges': 'Turns suggesting on or off. While it is on, edits show as suggestions.',
  'text.review.markup.simple': 'Shows the text with the changes made, and a bar at each change.',
  'text.review.markup.all': 'Shows every insertion, deletion, format change, and comment.',
  'text.review.markup.none': 'Shows the text with the changes made and hides the marks.',
  'text.review.accept': 'Accepts the change at the caret and goes to the next one.',
  'text.review.reject': 'Rejects the change at the caret and goes to the next one.',
  'text.review.acceptAll': 'Accepts every change on the page.',
  'text.review.rejectAll': 'Rejects every change on the page.',
  'text.review.acceptByAuthor': 'Accepts every change one person made.',
  'text.review.rejectByAuthor': 'Rejects every change one person made.',
  'text.review.previousChange': 'Goes to the change before the caret.',
  'text.review.nextChange': 'Goes to the change after the caret.',
};
