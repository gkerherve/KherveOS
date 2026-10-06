"""kherveos_runtime — how the KherveOS Python worker runs code.

Three ways in:
  run_cell(source, ns)          notebook cell: echo the trailing expression,
                                capture matplotlib figures (KherveBook)
  run_repl_line(line, ns)       interactive prompt, one line at a time (Terminal)
  run_script(path, argv, cwd)   `python file.py args` (Terminal)

Top-level `await` works everywhere (e.g. `await micropip.install("x")`).
"""

import ast
import base64
import builtins
import codeop
import inspect
import io
import os
import sys
import traceback
import warnings

HOME = "/home/user"
FLAGS = ast.PyCF_ALLOW_TOP_LEVEL_AWAIT
os.environ["MPLBACKEND"] = "Agg"
warnings.filterwarnings("ignore", message=".*non-interactive, and thus cannot be shown")

_namespaces: dict[str, dict] = {}
_repl_buffers: dict[str, list[str]] = {}


def _no_input(prompt=""):
    raise RuntimeError("input() is not available in KherveOS yet; put the values in the code instead.")


builtins.input = _no_input


def namespace(name: str) -> dict:
    ns = _namespaces.get(name)
    if ns is None:
        ns = {"__name__": "__main__", "__builtins__": builtins}
        _namespaces[name] = ns
    return ns


def reset(name: str) -> None:
    _namespaces.pop(name, None)
    _repl_buffers.pop(name, None)


def _repr(value) -> str:
    try:
        text = repr(value)
    except Exception as exc:  # a broken __repr__ shouldn't kill the cell
        text = f"<repr failed: {exc!r}>"
    return text if len(text) <= 20000 else text[:20000] + " …"


def _hint(exc: BaseException) -> str:
    if isinstance(exc, ModuleNotFoundError) and exc.name:
        top = exc.name.split(".")[0]
        return f"\nTip: if '{top}' is a pure-Python package on PyPI, install it with:  %pip install {top}"
    return ""


def _format_error(exc: BaseException) -> dict:
    tb = traceback.TracebackException.from_exception(exc)
    # Hide this file's own frames: users only care about their code.
    tb.stack = traceback.StackSummary.from_list(
        [f for f in tb.stack if not f.filename.endswith("kherveos_runtime.py")]
    )
    return {
        "type": type(exc).__name__,
        "message": str(exc),
        "traceback": "".join(tb.format()).rstrip() + _hint(exc),
    }


def capture_figures() -> list[str]:
    """Render every open matplotlib figure to a base64 PNG, then close them."""
    plt = sys.modules.get("matplotlib.pyplot")
    if plt is None:
        return []
    figures = []
    for num in plt.get_fignums():
        fig = plt.figure(num)
        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=110, bbox_inches="tight")
        figures.append(base64.b64encode(buf.getvalue()).decode("ascii"))
    plt.close("all")
    return figures


async def _run(code_obj, ns):
    value = eval(code_obj, ns)
    if inspect.iscoroutine(value):
        value = await value
    return value


def _flush():
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.flush()
        except Exception:
            pass


async def run_cell(source: str, ns_name: str, filename: str = "<cell>") -> dict:
    ns = namespace(ns_name)
    out = {"ok": True, "result": None, "figures": [], "error": None}
    try:
        tree = ast.parse(source, filename=filename, mode="exec")
        trailing = None
        if tree.body and isinstance(tree.body[-1], ast.Expr):
            trailing = ast.Expression(tree.body.pop().value)
        await _run(compile(tree, filename, "exec", flags=FLAGS), ns)
        if trailing is not None:
            value = await _run(compile(trailing, filename, "eval", flags=FLAGS), ns)
            if value is not None:
                ns["_"] = value
                out["result"] = _repr(value)
    except BaseException as exc:  # SystemExit and KeyboardInterrupt too
        out["ok"] = False
        out["error"] = _format_error(exc)
    _flush()
    try:
        out["figures"] = capture_figures()
    except Exception as exc:
        print(f"Could not render the figure: {exc}", file=sys.stderr)
    return out


_compiler = codeop.CommandCompiler()
_compiler.compiler.flags |= FLAGS


async def run_repl_line(line: str, ns_name: str) -> dict:
    """Feed one line to an interactive prompt. `more` means "keep typing" (…)."""
    ns = namespace(ns_name)
    buf = _repl_buffers.setdefault(ns_name, [])
    buf.append(line)
    source = "\n".join(buf)
    try:
        code_obj = _compiler(source, "<stdin>", "single")
    except (SyntaxError, OverflowError, ValueError) as exc:
        buf.clear()
        print("".join(traceback.format_exception_only(exc)).rstrip(), file=sys.stderr)
        return {"ok": False, "more": False, "figures": []}
    if code_obj is None:
        return {"ok": True, "more": True, "figures": []}
    buf.clear()
    ok = True
    try:
        await _run(code_obj, ns)
    except SystemExit:
        _flush()
        return {"ok": True, "more": False, "exit": True, "figures": []}
    except BaseException as exc:
        ok = False
        print(_format_error(exc)["traceback"], file=sys.stderr)
    _flush()
    try:
        figures = capture_figures()
    except Exception:
        figures = []
    return {"ok": ok, "more": False, "figures": figures}


def repl_reset_buffer(ns_name: str) -> None:
    _repl_buffers.pop(ns_name, None)


async def run_script(path: str, argv: list, cwd: str) -> dict:
    ns = {"__name__": "__main__", "__file__": path, "__builtins__": builtins}
    old_argv = sys.argv
    sys.argv = [path, *argv]
    script_dir = os.path.dirname(path)
    sys.path.insert(0, script_dir)
    exit_code = 0
    try:
        os.chdir(cwd)
        with open(path, encoding="utf-8") as f:
            source = f.read()
        await _run(compile(source, path, "exec", flags=FLAGS), ns)
    except SystemExit as exc:
        code = exc.code
        exit_code = code if isinstance(code, int) else (0 if code is None else 1)
        if code is not None and not isinstance(code, int):
            print(code, file=sys.stderr)
    except BaseException as exc:
        exit_code = 1
        print(_format_error(exc)["traceback"], file=sys.stderr)
    finally:
        sys.argv = old_argv
        if sys.path and sys.path[0] == script_dir:
            sys.path.pop(0)
    _flush()
    try:
        figures = capture_figures()
    except Exception:
        figures = []
    return {"ok": exit_code == 0, "exit_code": exit_code, "figures": figures}


def chdir(path: str) -> None:
    try:
        os.chdir(path)
    except OSError:
        os.chdir(HOME)
