#!/usr/bin/env python3
"""Minimal GEPA prompt optimizer for CSV classification.

Uses `gepa.optimize` directly (same style as the official quick-start), with:
- CSV train/val loading
- optional prompt extraction from apps/api/src/services/llmService.ts
- exact label-match evaluator for classification

Please note, i didnt actually run this here, i used my work project instead since I recently
made a GEPA prompt optimizer webapp that is perfectly suited for this kind of task. 

This is starter code meant to show the example of what the GEPA prompt optimization stack
looks like and can do.  I will also post a screenshot of my run 
"""

from __future__ import annotations

import argparse
import csv
import re
from pathlib import Path
from typing import List

import gepa
from gepa.adapters.default_adapter.default_adapter import EvaluationResult

DEFAULT_SERVICE_FILE = Path("apps/api/src/services/llmService.ts")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="GEPA optimize for CSV classification")
    p.add_argument("--train-csv", required=True)
    p.add_argument("--val-csv", required=True)
    p.add_argument("--label-column", required=True)
    p.add_argument(
        "--feature-columns",
        default="",
        help="Comma-separated list. Default: all columns except label.",
    )
    p.add_argument("--service-file", default=str(DEFAULT_SERVICE_FILE))
    p.add_argument("--seed-prompt-file", default="")
    p.add_argument("--task-lm", default="openai/gpt-4.1-mini")
    p.add_argument("--reflection-lm", default="openai/gpt-5")
    p.add_argument("--max-metric-calls", type=int, default=150)
    p.add_argument("--business-type", default="small business")
    p.add_argument("--aggressiveness-level", default="moderate")
    p.add_argument("--output-file", default="/tmp/gepa_optimized_prompt.txt")
    return p.parse_args()


def read_csv(path: Path) -> List[dict[str, str]]:
    with path.open("r", encoding="utf-8", newline="") as f:
        return [dict(r) for r in csv.DictReader(f)]


def pick_feature_columns(rows: List[dict[str, str]], label_column: str, feature_columns: str) -> List[str]:
    if not rows:
        raise ValueError("CSV is empty")
    headers = list(rows[0].keys())
    if label_column not in headers:
        raise ValueError(f"label column '{label_column}' not in CSV headers: {headers}")
    if feature_columns.strip():
        cols = [c.strip() for c in feature_columns.split(",") if c.strip()]
        missing = [c for c in cols if c not in headers]
        if missing:
            raise ValueError(f"missing feature columns: {missing}")
        return cols
    return [h for h in headers if h != label_column]


def extract_prompt_from_service(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    match = re.search(r"const\\s+prompt\\s*=\\s*\\[(.*?)\\]\\.join\\(\"\\\\n\"\\);", text, flags=re.DOTALL)
    if not match:
        raise ValueError(f"Could not find prompt block in {path}")

    block = match.group(1)
    parts = re.findall(r"`([^`]+)`", block)
    if not parts:
        raise ValueError("No template literal parts found in prompt block")

    prompt = "\n".join(parts)
    prompt = prompt.replace("${businessType}", "{business_type}")
    prompt = prompt.replace("${aggressivenessLevel}", "{aggressiveness_level}")
    return prompt


def build_seed_prompt(args: argparse.Namespace) -> dict[str, str]:
    if args.seed_prompt_file:
        text = Path(args.seed_prompt_file).read_text(encoding="utf-8")
    else:
        text = extract_prompt_from_service(Path(args.service_file))

    text = text.replace("{business_type}", args.business_type)
    text = text.replace("{aggressiveness_level}", args.aggressiveness_level)
    text += "\n\nReturn only the label string. No explanation."
    return {"system_prompt": text}


def to_dataset(rows: List[dict[str, str]], label_column: str, feature_cols: List[str]) -> List[dict[str, object]]:
    dataset: List[dict[str, object]] = []
    for row in rows:
        answer = (row.get(label_column) or "").strip()
        if not answer:
            continue
        input_text = "\n".join(f"{k}: {row.get(k, '').strip()}" for k in feature_cols)
        dataset.append({
            "input": input_text,
            "additional_context": {},
            "answer": answer,
        })
    if not dataset:
        raise ValueError("No usable rows with non-empty labels")
    return dataset


def exact_label_evaluator(data: dict, response: str) -> EvaluationResult:
    expected = str(data["answer"]).strip().lower()
    predicted = response.strip().splitlines()[0].strip().strip('"').strip("'").lower()
    ok = predicted == expected
    feedback = (
        f"Correct. Expected='{data['answer']}', Predicted='{response.strip()}'"
        if ok
        else f"Incorrect. Expected='{data['answer']}', Predicted='{response.strip()}'. Return only the label."
    )
    return EvaluationResult(score=1.0 if ok else 0.0, feedback=feedback, objective_scores=None)


def main() -> int:
    args = parse_args()

    train_rows = read_csv(Path(args.train_csv))
    val_rows = read_csv(Path(args.val_csv))
    feature_cols = pick_feature_columns(train_rows, args.label_column, args.feature_columns)

    trainset = to_dataset(train_rows, args.label_column, feature_cols)
    valset = to_dataset(val_rows, args.label_column, feature_cols)

    seed_prompt = build_seed_prompt(args)

    result = gepa.optimize(
        seed_candidate=seed_prompt,
        trainset=trainset,
        valset=valset,
        task_lm=args.task_lm,
        evaluator=exact_label_evaluator,
        max_metric_calls=args.max_metric_calls,
        reflection_lm=args.reflection_lm,
    )

    best = result.best_candidate["system_prompt"]
    Path(args.output_file).write_text(best, encoding="utf-8")

    print("Optimized prompt:")
    print(best)
    print(f"\nSaved to: {args.output_file}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
