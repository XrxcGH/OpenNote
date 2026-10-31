// Where the image lab's picture comes from: a PNG or JPEG the student opens, or the built-in example.
import { useState } from 'react';
import { Note, Problem } from '../shared/ui';
import styles from '../shared/kit.module.css';
import { readImageFile, setPicture, usePicture } from './source';
import { w } from './words';

export function PictureSource() {
  const picture = usePicture();
  const [problem, setProblem] = useState('');
  return (
    <>
      <label className={styles.field}>
        <span>{w('openImage')}</span>
        <input
          type="file"
          accept="image/png,image/jpeg"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file)
              void readImageFile(file).then(
                (next) => (setPicture(next), setProblem('')),
                () => setProblem(w('openProblem')),
              );
          }}
        />
      </label>
      <Note>
        {w('imageNote', {
          name: picture.name === 'example' ? w('exampleName') : picture.name,
          width: picture.image.width,
          height: picture.image.height,
        })}
      </Note>
      {problem ? <Problem text={problem} /> : null}
    </>
  );
}
