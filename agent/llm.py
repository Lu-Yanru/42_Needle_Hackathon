# Model: qwen2.5-coder:7b via Ollama (local, free, no API key needed)
# Endpoint: http://localhost:11434/api/generate
# Chosen for strong code generation at 7B params; fits most hardware
# Fallback: deepseek-coder:6.7b — auto-activates after 3 consecutive primary failures
# stream=False: full response in one round-trip, simpler parsing

import json
import time

import requests

OLLAMA_URL = "http://localhost:11434/api/generate"
MODEL_PRIMARY = "qwen2.5-coder:7b"
MODEL_FALLBACK = "deepseek-coder:6.7b"
TIMEOUT = 120  # seconds per request

# module-level fallback state
_primary_consecutive_errors = 0
_active_model = MODEL_PRIMARY


def _post(model: str, prompt: str, system: str) -> tuple[str, str]:
    payload = {"model": model, "prompt": prompt, "stream": False}
    if system:
        payload["system"] = system
    resp = requests.post(OLLAMA_URL, json=payload, timeout=TIMEOUT)
    resp.raise_for_status()
    data = resp.json()
    return data.get("response", ""), data.get("stop_reason", data.get("done_reason", "stop"))


def call_model(prompt: str, system: str = "") -> str:
    global _primary_consecutive_errors, _active_model

    model = _active_model
    last_exc: Exception | None = None

    for attempt in range(3):
        try:
            text, stop_reason = _post(model, prompt, system)
            if model == MODEL_PRIMARY:
                _primary_consecutive_errors = 0
            if stop_reason not in ("stop", "length", ""):
                import sys
                print(f"[llm] unexpected stop_reason={stop_reason!r}", file=sys.stderr)
            return text
        except (requests.ConnectionError, requests.Timeout) as e:
            last_exc = e
            if attempt < 2:
                time.sleep(1)
        except requests.HTTPError as e:
            last_exc = e
            break

    # all attempts on active model failed
    if model == MODEL_PRIMARY:
        _primary_consecutive_errors += 1
        if _primary_consecutive_errors >= 3:
            _active_model = MODEL_FALLBACK
            import sys
            print(f"[llm] switching to fallback model {MODEL_FALLBACK}", file=sys.stderr)
            try:
                text, _ = _post(MODEL_FALLBACK, prompt, system)
                return text
            except Exception as e:
                last_exc = e

    raise RuntimeError(f"call_model failed (model={model}, attempts=3): {last_exc}")


def call_model_json(prompt: str, schema_hint: str = "") -> dict:
    json_instruction = "Respond with ONLY valid JSON. No markdown, no prose, no code fences."
    if schema_hint:
        json_instruction += f" Expected shape: {schema_hint}"

    last_raw = ""
    for attempt in range(3):
        if attempt == 0:
            raw = call_model(prompt, system=json_instruction)
        else:
            raw = call_model(f"{json_instruction}\n\n{prompt}")

        last_raw = raw.strip()

        # strip markdown code fences (```json ... ``` or ``` ... ```)
        if last_raw.startswith("```"):
            lines = last_raw.splitlines()
            end = len(lines) - 1 if lines[-1].strip() == "```" else len(lines)
            last_raw = "\n".join(lines[1:end])

        try:
            return json.loads(last_raw)
        except (json.JSONDecodeError, ValueError):
            continue

    raise ValueError(f"call_model_json: no valid JSON after 3 attempts. Last response: {last_raw!r}")
