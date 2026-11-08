//! Local tabular-data conversion. Cell values are deliberately treated as
//! strings so CSV IDs, leading zeros and untrusted formulas are not retyped.
//! XLS/ODS/XLSX exports read the first visible worksheet as *values*,
//! not formulas or workbook formatting.
use crate::external::{output_dir, publish, verify_input};
use calamine::{open_workbook_auto, Reader};
use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};

const MAX_BYTES: u64 = 24 * 1024 * 1024;
const MAX_ROWS: usize = 50_000;
const MAX_COLUMNS: usize = 128;
const MAX_CELL_CHARS: usize = 32_000;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpreadsheetJob {
    path: String,
    target: String,
    destination: Option<String>,
}
fn valid_format(ext: &str) -> bool {
    matches!(ext, "csv" | "tsv" | "json" | "xlsx" | "xls" | "ods")
}
fn safe_cell(cell: &str) -> String {
    // CSV injection defence when users later open exports in Excel.
    let trimmed = cell.trim_start();
    if trimmed.starts_with('=') || trimmed.starts_with('+') ||
        trimmed.starts_with('@') || trimmed.starts_with('\t') ||
        trimmed.starts_with('\r') ||
        (trimmed.starts_with('-') && trimmed.parse::<f64>().is_err()) {
        format!("'{cell}")
    } else {
        cell.to_owned()
    }
}
fn parse_delimited(path: &Path, delimiter: u8) -> Result<Vec<Vec<String>>, String> {
    let mut reader = csv::ReaderBuilder::new().has_headers(false)
        .flexible(true).delimiter(delimiter).from_path(path)
        .map_err(|e| format!("Cannot open delimited text: {e}"))?;
    let mut rows = Vec::new();
    for result in reader.records() {
        let record = result.map_err(|e| format!("Invalid CSV/TSV input: {e}"))?;
        rows.push(record.iter().map(str::to_owned).collect());
        if rows.len() > MAX_ROWS { return Err("More than 50,000 rows".into()); }
    }
    Ok(rows)
}
fn cell_from_json(value: &serde_json::Value) -> Result<String, String> {
    match value {
        serde_json::Value::Null => Ok(String::new()),
        serde_json::Value::String(s) => Ok(s.clone()),
        serde_json::Value::Number(n) => Ok(n.to_string()),
        serde_json::Value::Bool(b) => Ok(b.to_string()),
        _ => Err("JSON cells must be strings, numbers, booleans or null".into()),
    }
}
fn parse_json(path: &Path) -> Result<Vec<Vec<String>>, String> {
    let data = fs::read(path).map_err(|e| e.to_string())?;
    let value: serde_json::Value = serde_json::from_slice(&data)
        .map_err(|e| format!("Invalid JSON table: {e}"))?;
    let items = value.as_array().ok_or("JSON table must be an array of rows")?;
    if items.len() > MAX_ROWS { return Err("More than 50,000 rows".into()); }
    let mut result = Vec::new();
    for row in items {
        let cells = row.as_array().ok_or("Every JSON row must be an array")?;
        result.push(cells.iter().map(cell_from_json).collect::<Result<Vec<_>,_>>()?);
    }
    Ok(result)
}
fn parse_workbook(path: &Path) -> Result<Vec<Vec<String>>, String> {
    let mut book = open_workbook_auto(path).map_err(|e| format!("Cannot read workbook: {e}"))?;
    let sheet = book.sheet_names().first().cloned().ok_or("Workbook has no worksheets")?;
    let range = book.worksheet_range(&sheet).map_err(|e| format!("Cannot read sheet: {e}"))?;
    if range.height() > MAX_ROWS { return Err("Worksheet exceeds 50,000 rows".into()); }
    let rows: Vec<Vec<String>> = range.rows().map(|row|
        row.iter().map(ToString::to_string).collect()).collect();
    Ok(rows)
}
fn validate_table(rows: &[Vec<String>]) -> Result<(), String> {
    if rows.is_empty() { return Err("Input table is empty".into()); }
    if rows.len() > MAX_ROWS { return Err("Maximum 50,000 rows".into()); }
    for cells in rows {
        if cells.len() > MAX_COLUMNS { return Err("Maximum 128 columns".into()); }
        for cell in cells {
            if cell.chars().count() > MAX_CELL_CHARS { return Err("Cell exceeds 32,000 characters".into()); }
            if cell.contains('\0') { return Err("Table contains invalid NUL characters".into()); }
        }
    }
    Ok(())
}
fn write_delimited(rows: &[Vec<String>], stage: &Path, separator: u8) -> Result<(), String> {
    let mut writer = csv::WriterBuilder::new().delimiter(separator).from_path(stage)
        .map_err(|e| e.to_string())?;
    for row in rows {
        writer.write_record(row.iter().map(|cell| safe_cell(cell)))
            .map_err(|e| e.to_string())?;
    }
    writer.flush().map_err(|e| e.to_string())
}
fn write_xlsx(rows: &[Vec<String>], stage: &Path) -> Result<(), String> {
    let mut book = rust_xlsxwriter::Workbook::new();
    let sheet = book.add_worksheet();
    sheet.set_name("Data").map_err(|e| e.to_string())?;
    for (row_no, row) in rows.iter().enumerate() {
        for (col_no, cell) in row.iter().enumerate() {
            // write_string not write_formula: imported text must stay inert.
            sheet.write_string(row_no as u32, col_no as u16, cell)
                .map_err(|e| format!("Cannot write XLSX cell: {e}"))?;
        }
    }
    book.save(stage).map_err(|e| format!("Cannot save XLSX: {e}"))
}
fn convert(job: SpreadsheetJob) -> Result<String,String> {
    let input = PathBuf::from(&job.path);
    verify_input(&input, false)?;
    let ext = input.extension().and_then(|v| v.to_str())
        .unwrap_or("").to_ascii_lowercase();
    if !valid_format(&ext) || !matches!(job.target.as_str(), "csv" | "tsv" | "json" | "xlsx") {
        return Err("Supported spreadsheet routes: CSV, TSV, JSON and XLSX; XLS/ODS input only".into());
    }
    if ext == job.target { return Err("Choose a different output format".into()); }
    if fs::metadata(&input).map_err(|e| e.to_string())?.len() > MAX_BYTES {
        return Err("Source spreadsheet exceeds 24 MB".into());
    }
    let rows = match ext.as_str() {
        "csv" => parse_delimited(&input, b',')?,
        "tsv" => parse_delimited(&input, b'\t')?,
        "json" => parse_json(&input)?,
        _ => parse_workbook(&input)?,
    };
    validate_table(&rows)?;
    let folder = output_dir(&input, job.destination.as_deref())?;
    let staging = tempfile::Builder::new().prefix(".reformany-data-")
        .tempdir_in(&folder).map_err(|e| e.to_string())?;
    let staged = staging.path().join(format!("result.{}", job.target));
    match job.target.as_str() {
        "csv" => write_delimited(&rows, &staged, b',')?,
        "tsv" => write_delimited(&rows, &staged, b'\t')?,
        "json" => {
            let json = serde_json::to_vec_pretty(&rows).map_err(|e| e.to_string())?;
            fs::write(&staged, json).map_err(|e| e.to_string())?;
        }
        "xlsx" => write_xlsx(&rows, &staged)?,
        _ => unreachable!(),
    }
    if fs::metadata(&staged).map_err(|e| e.to_string())?.len() == 0 {
        return Err("Spreadsheet conversion produced an empty file".into());
    }
    // Decode what was written rather than just trusting an exit status.
    let verified = match job.target.as_str() {
        "csv" => parse_delimited(&staged,b',')?,
        "tsv" => parse_delimited(&staged,b'\t')?,
        "json" => parse_json(&staged)?,
        "xlsx" => parse_workbook(&staged)?,
        _ => unreachable!(),
    };
    if verified.len() != rows.len() { return Err("Spreadsheet output lost rows".into()); }
    let stem = input.file_stem().and_then(|s| s.to_str()).unwrap_or("Data");
    publish(&staged, &folder, stem, &job.target)
        .map(|p| p.to_string_lossy().into_owned())
}
#[tauri::command]
pub async fn spreadsheet_convert(job: SpreadsheetJob) -> Result<String,String> {
    tauri::async_runtime::spawn_blocking(move || convert(job))
        .await.map_err(|_| "Spreadsheet worker failed".to_owned())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_leading_zeros_through_xlsx() {
        let dir=tempfile::tempdir().unwrap();
        let source=dir.path().join("codes.csv");
        fs::write(&source,"ID,Name\n00125,Example\n00401,مرحبا\n").unwrap();
        let xlsx=convert(SpreadsheetJob {path:source.to_string_lossy().into_owned(),
            target:"xlsx".into(),destination:None}).unwrap();
        let rows=parse_workbook(Path::new(&xlsx)).unwrap();
        assert_eq!(rows[1][0],"00125");
        let csv=convert(SpreadsheetJob {path:xlsx,target:"csv".into(),destination:None}).unwrap();
        assert!(fs::read_to_string(csv).unwrap().contains("00401"));
    }
    #[test]
    fn json_and_tsv_are_real_roundtrip_routes() {
        let dir=tempfile::tempdir().unwrap();
        let source=dir.path().join("rows.tsv");
        fs::write(&source,"Code\tTitle\nA-1\tHello\n").unwrap();
        let json=convert(SpreadsheetJob {path:source.to_string_lossy().into_owned(),
            target:"json".into(),destination:None}).unwrap();
        let rows=parse_json(Path::new(&json)).unwrap();
        assert_eq!(rows[1][1],"Hello");
    }
    #[test]
    fn csv_injection_is_escaped() {
        assert_eq!(safe_cell("=SUM(A1:A2)"),"'=SUM(A1:A2)");
        assert_eq!(safe_cell("0042"),"0042");
        assert_eq!(safe_cell("-2.25"),"-2.25");
    }
}
