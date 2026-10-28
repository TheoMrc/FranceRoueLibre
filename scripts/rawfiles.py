"""Locate downloaded source files: a dataset is either one file (<id>.csv.gz) or yearly chunks (<id>--YYYY.csv.gz)."""
import glob
import os

RAW = 'sources/raw'


def files(source_id):
    chunks = sorted(glob.glob(f'{RAW}/{source_id}--*.csv.gz'))
    if chunks:
        return chunks
    single = f'{RAW}/{source_id}.csv.gz'
    return [single] if os.path.exists(single) else []


def csv(source_id, extra=''):
    """DuckDB table expression over all files of a source, or None when absent."""
    paths = files(source_id)
    if not paths:
        return None
    listing = ', '.join(f"'{p}'" for p in paths)
    return f"read_csv([{listing}], delim=';', header=true, all_varchar=true, union_by_name=true, ignore_errors=true{extra})"
