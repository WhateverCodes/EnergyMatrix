import os
import tempfile

# isolate the SQLite DB for the whole test session
os.environ.setdefault("GRIDTWIN_DB", os.path.join(tempfile.mkdtemp(prefix="gridtwin-test-"), "test.db"))
