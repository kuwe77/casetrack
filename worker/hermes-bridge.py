"""One tool-free model call through an existing Hermes installation. JSON over stdin/stdout.
No agent session, skills, memory, terminals, or database credentials are given to the model.
Hermes' auxiliary API is version-dependent: run the doctor after upgrading Hermes.
"""
import contextlib, io, json, os, sys

def main():
    root = os.environ.get('HERMES_SOURCE')
    if not root:
        raise RuntimeError('HERMES_SOURCE is required')
    sys.path.insert(0, root)
    # Capture framework diagnostics; never print its credentials or user content.
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        # Current Hermes installs activate their managed dependency generation here.
        # Bootstrap may re-exec Python, so do this BEFORE consuming stdin.
        from pathlib import Path
        if (Path(root) / 'hermes_bootstrap.py').exists():
            import hermes_bootstrap
        request = json.load(sys.stdin)
        from dotenv import load_dotenv
        from pathlib import Path
        load_dotenv(Path(os.environ.get('HERMES_HOME', str(Path.home()/'.hermes'))) / '.env', override=False)
        from hermes_cli.config import load_config
        from agent.auxiliary_client import call_llm
        cfg = load_config()
        model_cfg = cfg.get('model', {})
        provider = os.environ.get('CASETRACK_MODEL_PROVIDER') or model_cfg.get('provider')
        model = os.environ.get('CASETRACK_MODEL') or model_cfg.get('default')
        if not provider or not model:
            raise RuntimeError('Configure a Hermes model first')
        response = call_llm(provider=provider, model=model, messages=request['messages'], tools=[], timeout=60, max_tokens=500)
        message = response.choices[0].message if hasattr(response, 'choices') else response['choices'][0]['message']
        content = message.content if hasattr(message, 'content') else message.get('content')
        if not isinstance(content, str):
            raise RuntimeError('Model did not return content')
        result = json.loads(content)
    print(json.dumps(result))

if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Hermes inference failed; no reply was generated.', file=sys.stderr)
        sys.exit(1)
