"""Format version 2 for the reference reader, in one namespace for the tests and the schema checks.

- `values_v2`: the shared value grammars (spec Appendix D).
- `inline_tags`: the reserved inline tags and the marks they name (spec 7.9 and 7.10).
- `inline_read` and `inline_write`: Markdown 2 to the neutral tree of the fixtures and back (spec 7.6 to 7.13).
- `stamp_v2`: stamping and reading rules (spec 15), and what a reader computes from `data.sheet` (spec 6.3).

Like the rest of the reference reader, they use only the Python standard library.
"""

from inline_read import *  # noqa: F403
from inline_tags import *  # noqa: F403
from inline_write import *  # noqa: F403
from stamp_v2 import *  # noqa: F403
from values_v2 import *  # noqa: F403
