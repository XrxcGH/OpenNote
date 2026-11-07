// Says in words what the sandbox's bare Python errors mean. The runtime ends a blocked file read with "OSError: 44"
// and a network import with "ImportError: no module named ..."; neither says that the sandbox blocks files and the
// network.
import { t } from '../../strings/t';

/** The error text with a plain line after the two errors a blocked file or network access ends in. */
export function explainSandboxError(text: string): string {
  return text
    .replace(/^OSError: (?:\[Errno )?(?:44|2)\]?[ \t]*$/gm, (line) => `${line}\n${t('codeCells.blocked.files')}`)
    .replace(/^ImportError: no module named .*$/gm, (line) => `${line}\n${t('codeCells.blocked.modules')}`);
}
