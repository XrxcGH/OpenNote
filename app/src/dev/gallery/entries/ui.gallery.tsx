// The interface primitives in the states that matter for their look and for accessibility. Later packages add their
// own files beside this one, one per area, and never edit this one.

import { useState } from 'react';
import { Button, Switch, TextField } from '../../../ui';
import { defineGallery } from '../registry';

function Fields() {
  const [name, setName] = useState('Biology 101');
  return (
    <>
      <TextField label="Notebook name" value={name} onChange={setName} help="Shown in the library." />
      <TextField label="Section name" value="" onChange={() => {}} error="A section needs a name." />
    </>
  );
}

function Switches() {
  const [on, setOn] = useState(true);
  const [off, setOff] = useState(false);
  return (
    <>
      <Switch label="Reduce motion" checked={on} onChange={setOn} />
      <Switch label="Work offline" checked={off} onChange={setOff} />
      <Switch label="Locked" checked={false} onChange={() => {}} disabled="aria" />
    </>
  );
}

export default defineGallery([
  {
    id: 'ui.button.variants',
    title: 'Buttons',
    group: 'Primitives',
    description: 'The four variants, enabled and disabled.',
    render: () => (
      <>
        <Button variant="primary">Save page</Button>
        <Button>Cancel</Button>
        <Button variant="quiet">Skip</Button>
        <Button variant="danger">Delete</Button>
        <Button variant="primary" disabled>
          Save page
        </Button>
      </>
    ),
  },
  {
    id: 'ui.switch.states',
    title: 'Switches',
    group: 'Primitives',
    description: 'On, off, and disabled with an explanation.',
    render: () => <Switches />,
  },
  {
    id: 'ui.textfield.states',
    title: 'Text fields',
    group: 'Primitives',
    description: 'With help text, and with an error.',
    render: () => <Fields />,
  },
]);
