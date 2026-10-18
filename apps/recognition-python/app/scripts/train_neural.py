import argparse
import hashlib
import json
import random
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from sklearn.model_selection import GroupShuffleSplit
from torch import nn
from torch.utils.data import DataLoader, Dataset

from datasets.google_asl import load_sequence
from recognition.neural import ASLConvNet, NUM_FRAMES, prepare_sequence

ROOT = Path(__file__).resolve().parents[1]
DATASET_DIR = ROOT / "data" / "raw" / "google_asl"
MODEL_DIR = ROOT / "models" / "asl_cnn_all_signs"
CACHE_DIR = ROOT / "data" / "processed" / "asl_cnn_all_signs"
SEED = 42


def find_training_labels():
    """Read labels only from train.csv, and recordings only from train_landmarks_files/."""
    label_file = DATASET_DIR / "train.csv"
    recordings_dir = DATASET_DIR / "train_landmark_files"

    if not label_file.is_file():
        raise FileNotFoundError(
            f"Missing training labels: {label_file}. "
            "Place train.csv inside data/raw/google_asl/."
        )
    if not recordings_dir.is_dir():
        raise FileNotFoundError(
            f"Missing training recordings folder: {recordings_dir}. "
            "The expected folder name is train_landmarks_files."
        )

    table = pd.read_csv(label_file)
    if not {"path", "sign"}.issubset(table.columns):
        raise ValueError(
            "train.csv must contain 'path' and 'sign' columns. "
            f"Found: {list(table.columns)}"
        )

    table = table.dropna(subset=["path", "sign"]).copy()
    table["sign"] = table["sign"].astype(str)

    def normalize_recording_path(csv_path):
        """Use the requested folder even if CSV uses Google's singular spelling."""
        parts = str(csv_path).replace("\\", "/").lstrip("./").split("/")
        if parts[0] not in {"train_landmarks_files", "train_landmark_files"}:
            raise ValueError(
                f"Unsupported path in train.csv: {csv_path!r}. "
                "Expected train_landmarks_files/... or train_landmark_files/..."
            )
        if len(parts) < 3:
            raise ValueError(f"Invalid recording path in train.csv: {csv_path!r}")
        return "/".join(["train_landmarks_files", *parts[1:]])

    table["path"] = table["path"].map(normalize_recording_path)

    if "participant_id" in table.columns:
        table["participant_id"] = table["participant_id"].astype(str)
    else:
        table["participant_id"] = table["path"].map(lambda path: Path(path).parts[1])

    table = table[["path", "sign", "participant_id"]]
    table = table.drop_duplicates(subset=["path"]).reset_index(drop=True)

    if table.empty:
        raise RuntimeError("train.csv has no labelled training recordings")

    print(f"Reading labels exclusively from: {label_file}")
    print(f"Reading recordings exclusively from: {recordings_dir}")
    return table, label_file


def fingerprint(records, label_file):
    digest = hashlib.sha256()
    digest.update(str(label_file.resolve()).encode())
    digest.update(str(label_file.stat().st_size).encode())
    digest.update(str(label_file.stat().st_mtime_ns).encode())
    digest.update(str(NUM_FRAMES).encode())
    digest.update(b"train_landmarks_files+train.csv-v2")
    for row in records.itertuples(index=False):
        digest.update(f"{row.path}|{row.sign}|{row.participant_id}\n".encode())
    return digest.hexdigest()


def build_or_read_cache(records, source_fingerprint):
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    features_path = CACHE_DIR / "features.npy"
    manifest_path = CACHE_DIR / "manifest.json"

    if features_path.exists() and manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest.get("fingerprint") == source_fingerprint:
            print("Using existing preprocessed landmark cache.")
            return np.load(features_path, mmap_mode="r"), manifest["entries"]

    print("Preprocessing training recordings (first run may take a while)...")
    matrix = np.lib.format.open_memmap(
        features_path,
        mode="w+",
        dtype=np.float32,
        shape=(len(records), 126, NUM_FRAMES),
    )
    entries = []
    skipped = 0

    for number, row in enumerate(records.itertuples(index=False), start=1):
        try:
            print("Made this row")
            sequence = load_sequence(DATASET_DIR, row.path)
            prepared = prepare_sequence(sequence)
            matrix[len(entries)] = prepared
            entries.append(
                {
                    "path": row.path,
                    "sign": row.sign,
                    "participant": str(row.participant_id),
                }
            )
        except (OSError, ValueError, KeyError) as exc:
            print(f"Skipping {row.path}: {exc}")
        if number % 1000 == 0:
            print(f"Processed {number}/{len(records)} recordings")

    matrix.flush()
    del matrix
    if not entries:
        raise RuntimeError("No usable training recordings. Check paths and labels.")
    manifest_path.write_text(
        json.dumps({"fingerprint": source_fingerprint, "entries": entries}),
        encoding="utf-8",
    )
    print(f"Cached {len(entries)} recordings; skipped {skipped}.")
    return np.load(features_path, mmap_mode="r"), entries


def split_indices(entries, labels):
    indices = np.arange(len(entries))
    groups = [row["participant"] for row in entries]
    signs = [row["sign"] for row in entries]

    if len(set(groups)) < 3:
        raise RuntimeError(
            "Need at least three participant groups for a signer-separated split."
        )

    for attempt in range(100):
        splitter = GroupShuffleSplit(
            n_splits=1, test_size=0.10, random_state=SEED + attempt
        )
        train_val, test = next(splitter.split(indices, groups=groups))
        train_val_groups = [groups[i] for i in train_val]
        if len(set(train_val_groups)) < 2:
            continue
        splitter2 = GroupShuffleSplit(
            n_splits=1, test_size=0.12, random_state=SEED + 100 + attempt
        )
        train_local, val_local = next(
            splitter2.split(train_val, groups=train_val_groups)
        )
        train, val = train_val[train_local], train_val[val_local]
        if set(signs[i] for i in train) == set(labels):
            return train.tolist(), val.tolist(), test.tolist()

    raise RuntimeError(
        "Could not produce a participant-separated training split containing "
        "every sign. Check how signs are distributed across participants."
    )


class LandmarkDataset(Dataset):
    def __init__(self, features, indices, targets):
        self.features = features
        self.indices = indices
        self.targets = targets

    def __len__(self):
        return len(self.indices)

    def __getitem__(self, position):
        index = self.indices[position]
        x = torch.from_numpy(np.array(self.features[index], copy=True))
        return x, torch.tensor(self.targets[index], dtype=torch.long)


def evaluate(model, loader, device):
    model.eval()
    correct, total, loss_sum = 0, 0, 0.0
    criterion = nn.CrossEntropyLoss()
    with torch.no_grad():
        for x, y in loader:
            x, y = x.to(device), y.to(device)
            logits = model(x)
            loss_sum += criterion(logits, y).item() * len(y)
            correct += (logits.argmax(1) == y).sum().item()
            total += len(y)
    return loss_sum / total, correct / total


def atomic_save(value, path):
    temporary = path.with_name(path.name + ".tmp")
    torch.save(value, temporary)
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=25)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--fresh", action="store_true")
    args = parser.parse_args()
    if args.epochs < 1 or args.batch_size < 1:
        parser.error("--epochs and --batch-size must be positive")

    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    MODEL_DIR.mkdir(parents=True, exist_ok=True)

    records, label_file = find_training_labels()
    print(f"Training labels: {label_file}")
    print(f"Labelled recordings: {len(records)}")
    source_fingerprint = fingerprint(records, label_file)
    features, entries = build_or_read_cache(records, source_fingerprint)

    labels = sorted({entry["sign"] for entry in entries})
    label_to_index = {label: i for i, label in enumerate(labels)}
    targets = [label_to_index[entry["sign"]] for entry in entries]
    print(
        f"Training ALL {len(labels)} available signs on {
            len(entries)
        } usable recordings"
    )

    train_idx, val_idx, test_idx = split_indices(entries, labels)
    split_paths = {
        "train": [entries[i]["path"] for i in train_idx],
        "validation": [entries[i]["path"] for i in val_idx],
        "test": [entries[i]["path"] for i in test_idx],
    }
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print("Device:", device)
    print("Train / validation / test:", len(train_idx), len(val_idx), len(test_idx))

    def loader(indices, shuffle):
        return DataLoader(
            LandmarkDataset(features, indices, targets),
            batch_size=args.batch_size,
            shuffle=shuffle,
            num_workers=0,
        )

    train_loader = loader(train_idx, True)
    val_loader = loader(val_idx, False)
    test_loader = loader(test_idx, False)

    model = ASLConvNet(len(labels)).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=0.001, weight_decay=0.001)
    criterion = nn.CrossEntropyLoss()
    checkpoint_path = MODEL_DIR / "checkpoint.pt"
    best_path = MODEL_DIR / "model.pt"
    start_epoch, best_val_accuracy, best_state = 0, -1.0, None

    if checkpoint_path.exists() and not args.fresh:
        checkpoint = torch.load(checkpoint_path, map_location=device, weights_only=True)
        if (
            checkpoint["labels"] != labels
            or checkpoint["source_fingerprint"] != source_fingerprint
            or checkpoint["split_paths"] != split_paths
        ):
            raise RuntimeError(
                "Checkpoint belongs to a different dataset/split/class set. "
                "Use a different model folder, or back up this one and use --fresh."
            )
        model.load_state_dict(checkpoint["model_state_dict"])
        optimizer.load_state_dict(checkpoint["optimizer_state_dict"])
        start_epoch = checkpoint["epoch"]
        best_val_accuracy = checkpoint["best_val_accuracy"]
        best_state = checkpoint["best_state_dict"]
        print(f"Resuming from epoch {start_epoch}")

    (MODEL_DIR / "labels.json").write_text(
        json.dumps(labels, indent=2), encoding="utf-8"
    )
    (MODEL_DIR / "splits.json").write_text(
        json.dumps(split_paths, indent=2), encoding="utf-8"
    )

    for epoch in range(start_epoch, args.epochs):
        model.train()
        running_loss, count = 0.0, 0
        for x, y in train_loader:
            x, y = x.to(device), y.to(device)
            optimizer.zero_grad()
            loss = criterion(model(x), y)
            loss.backward()
            optimizer.step()
            running_loss += loss.item() * len(y)
            count += len(y)

        val_loss, val_accuracy = evaluate(model, val_loader, device)
        print(
            f"Epoch {epoch + 1}/{args.epochs} "
            f"train_loss={running_loss / count:.4f} "
            f"val_loss={val_loss:.4f} val_accuracy={val_accuracy:.2%}"
        )

        if val_accuracy > best_val_accuracy:
            best_val_accuracy = val_accuracy
            best_state = {
                k: v.detach().cpu().clone() for k, v in model.state_dict().items()
            }
            atomic_save(best_state, best_path)
            print("Saved new best model.pt")

        atomic_save(
            {
                "epoch": epoch + 1,
                "model_state_dict": model.state_dict(),
                "optimizer_state_dict": optimizer.state_dict(),
                "best_state_dict": best_state,
                "best_val_accuracy": best_val_accuracy,
                "labels": labels,
                "source_fingerprint": source_fingerprint,
                "split_paths": split_paths,
            },
            checkpoint_path,
        )
        print("Saved checkpoint.pt")

    if best_state is None:
        raise RuntimeError("No model weights available")
    model.load_state_dict(best_state)
    test_loss, test_accuracy = evaluate(model, test_loader, device)
    (MODEL_DIR / "metrics.json").write_text(
        json.dumps(
            {
                "best_validation_accuracy": best_val_accuracy,
                "test_accuracy": test_accuracy,
                "test_loss": test_loss,
                "completed_epochs": max(start_epoch, args.epochs),
                "sign_count": len(labels),
                "train_count": len(train_idx),
                "validation_count": len(val_idx),
                "test_count": len(test_idx),
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    atomic_save(best_state, best_path)
    print(f"Finished. Test accuracy: {test_accuracy:.2%}")
    print("Best weights:", best_path)
    print("Resume checkpoint:", checkpoint_path)


if __name__ == "__main__":
    main()
