# CLI File Analyzer

Build a CLI program called `solution.py`.

Usage:

```bash
python3 solution.py <input_file>
```

Requirements:

1. Read the given text file line by line.
2. Output ONLY valid JSON to stdout.
3. JSON format:

```json
{
  "lines": ["line1", "line2"],
  "count": 2
}
```

4. Preserve original line order.
5. Strip trailing newline characters.
6. Exit code:
   - 0 on success
   - 1 if file does not exist
7. If the file does not exist:
   - print exactly:
```json
{"error":"file not found"}
```

Constraints:
- No debug prints
- No extra stdout text
- Standard library only
