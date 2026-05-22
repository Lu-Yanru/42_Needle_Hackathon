import { describe, expect, test } from "bun:test";
import { parseTestOutput } from "./test-runner";

// A realistic scoreboard printed by secret_spec/test_runner/run_tests.py —
// "Overall [bar] N/M passed", a per-suite line, then one line per level.
const PARTIAL_SCOREBOARD = `
Knitting Compiler Scoreboard
Overall [###############################.] 142/150 passed (94.7%)
Failed: 8

public
  [######################..] 142/150
  level_01_valid_basics                [##################]  20/20
  level_02_stitches                    [#################.]  24/25
  level_03_brackets                    [##################]  25/25
  level_04_row_repeats                 [##################]  20/20
  level_05_single_errors               [#################.]  29/30
  level_06_multi_error_recovery        [################..]  13/15
  level_07_cli_output                  [##################]   5/5
  level_08_stress                      [############......]   6/10

Failures
- pub_level_02_stitches_007: $.errors[0].code: expected 'DUPLICATE_ROW', got 'OUT_OF_ORDER_ROW'
- pub_level_08_stress_003: exit code expected 1, got 0
`;

const FULL_PASS_SCOREBOARD = `
Knitting Compiler Scoreboard
Overall [################################] 150/150 passed (100.0%)
Failed: 0

public
  [########################] 150/150
  level_01_valid_basics                [##################]  20/20
  level_08_stress                      [##################]  10/10
`;

describe("parseTestOutput", () => {
  test("parses score and total from the official runner scoreboard", () => {
    const result = parseTestOutput(PARTIAL_SCOREBOARD);
    expect(result.score).toBe(142);
    expect(result.total).toBe(150);
  });

  test("collects levels with failures as failing categories", () => {
    const result = parseTestOutput(PARTIAL_SCOREBOARD);
    expect([...result.failing_categories].sort()).toEqual([
      "level_02_stitches",
      "level_05_single_errors",
      "level_06_multi_error_recovery",
      "level_08_stress",
    ]);
  });

  test("a fully passing run reports score == total and no failing categories", () => {
    const result = parseTestOutput(FULL_PASS_SCOREBOARD);
    expect(result.score).toBe(150);
    expect(result.total).toBe(150);
    expect(result.failing_categories).toEqual([]);
  });
});
