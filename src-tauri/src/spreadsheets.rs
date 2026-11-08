//! Local tabular file converter. The preview intentionally exports only one
//! worksheet, treats imported CSV/JSON cells as literal text (never formulas),
//! and maintains leading zeros. No inference or arbitrary macro execution.
use crate::external::{output_dir, publish, verify_input};
use calamine::{open_workbook_auto, Reader};
use serde::Deserialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

const MAX_FILE_BYTES: u64 = 24 * 1024 * 1024;
const MAX_ROWS: usize = 50_000;
const MAX_COLUMNS: usize = 200;
const MAX_CELL_CHARS: usize = 32_000;

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TableJob {
    path: String,
    target: String,
    destination: Option<String>,
}

fn check_table(rows: &[Vec<String>]) -> Result<(), String> {
    if rows.is_empty() || rows.len() > MAX_ROWS {
        return Err("Table must contain 1–50,000 rows".into());
    }
    for row in rows {
        if row.len() > MAX_COLUMNS {
            return Err("Table has more than 200 columns".into());
        }
        if row.iter().any(|value| value.chars().count() > MAX_CELL_CHARS) {
            return Err("A cell exceeds the 32,000 character preview limit".into());
        }
    }
    Ok(())
}

fn load_text_table(file: &Path, ext: &str) -> Result<Vec<Vec<String>>, String> {
    let bytes = fs::read(file).map_err(|e| e.to_string())?;
    let value = String::from_utf8(bytes).map_err(|_| "Table text must use UTF-8")?;
    if ext == "json" {
        let data: Value = serde_json::from_str(&value)
            .map_err(|e| format!("Invalid JSON table: {e}"))?;
        let items = data.as_array().ok_or("JSON table must be an array of row arrays")?;
        let mut rows = Vec::new();
        for item in items {
            let cells = item.as_array().ok_or("Every JSON row must be an array")?;
            let mut row = Vec::new();
            for cell in cells {
                let rendered = match cell {
                    Value::String(s) => s.clone(),
                    Value::Null => String::new(),
                    Value::Bool(v) => v.to_string(),
                    Value::Number(v) => v.to_string(),
                    _ => return Err("Nested JSON objects and arrays are not table cells".into()),
                };
                row.push(rendered);
            }
            rows.push(row);
            if rows.len() > MAX_ROWS { return Err("Too many rows in JSON table".into()); }
        }
        check_table(&rows)?;
        return Ok(rows);
    }
    let delimiter = if ext == "tsv" { b'\t' } else { b',' };
    let mut parser = csv::ReaderBuilder::new().has_headers(false)
        .flexible(true).delimiter(delimiter).from_reader(value.as_bytes());
    let mut rows = Vec::new();
    for record in parser.records() {
        let record = record.map_err(|e| format!("Invalid CSV/TSV table: {e}"))?;
        rows.push(record.iter().map(str::to_owned).collect());
        if rows.len() > MAX_ROWS { return Err("Too many rows in table".into()); }
    }
    check_table(&rows)?;
    Ok(rows)
}

fn load_excel(file: &Path) -> Result<Vec<Vec<String>>, String> {
    let mut workbook = open_workbook_auto(file).map_err(|e| format!("Cannot open workbook: {e}"))?;
    let sheet = workbook.sheet_names().first().cloned()
        .ok_or("Workbook contains no worksheets")?;
    let range = workbook.worksheet_range(&sheet)
        .map_err(|e| format!("Cannot read the first worksheet: {e}"))?;
    if range.height() > MAX_ROWS || range.width() > MAX_COLUMNS {
        return Err("Worksheet exceeds the 50,000 row / 200 column preview limit".into());
    }
    let rows = range.rows()
        .map(|r| r.iter().map(ToString::to_string).collect::<Vec<_>>())
        .collect::<Vec<_>>();
    check_table(&rows)?;
    Ok(rows)
}

fn write_text(rows: &[Vec<String>], target: &str, dest: &Path) -> Result<(), String> {
    if target == "json" {
        let data = serde_json::to_vec_pretty(rows).map_err(|e| e.to_string())?;
        fs::write(dest, data).map_err(|e| e.to_string())?;
    } else {
        let delim = if target == "tsv" { b'\t' } else { b',' };
        let file = fs::File::create(dest).map_err(|e| e.to_string())?;
        let mut out = csv::WriterBuilder::new().has_headers(false)
            .delimiter(delim).from_writer(file);
        for row in rows {
            out.write_record(row).map_err(|e| format!("Could not write table: {e}"))?;
        }
        out.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn write_xlsx(rows: &[Vec<String>], dest: &Path) -> Result<(), String> {
    let mut book = rust_xlsxwriter::Workbook::new();
    let sheet = book.add_worksheet();
    sheet.set_name("ReformANY data").map_err(|e| e.to_string())?;
    for (row_index, row) in rows.iter().enumerate() {
        for (column_index, cell) in row.iter().enumerate() {
            // Always literal strings: user-provided =FORMULA or +COMMAND text
            // is not executed by Excel when the workbook is opened.
            sheet.write_string(row_index as u32, column_index as u16, cell)
                .map_err(|e| format!("Cannot write cell: {e}"))?;
        }
    }
    book.save(dest).map_err(|e| format!("Could not save XLSX: {e}"))
}

fn convert(job: TableJob) -> Result<String, String> {
    if !matches!(job.target.as_str(), "csv" | "tsv" | "json" | "xlsx") {
        return Err("Destination must be CSV, TSV, JSON or XLSX".into());
    }
    let source = PathBuf::from(job.path);
    verify_input(&source, false)?;
    if fs::metadata(&source).map_err(|e| e.to_string())?.len() > MAX_FILE_BYTES {
        return Err("Spreadsheet exceeds the 24 MB preview limit".into());
    }
    let ext = source.extension().and_then(|e| e.to_str())
        .unwrap_or("").to_ascii_lowercase();
    let rows = match ext.as_str() {
        "csv" | "tsv" | "json" => load_text_table(&source, &ext)?,
        "xlsx" | "xls" | "ods" => load_excel(&source)?,
        _ => return Err("Source must be CSV, TSV, JSON, XLSX, XLS or ODS".into()),
    };
    check_table(&rows)?;
    let folder = output_dir(&source, job.destination.as_deref())?;
    let stage = tempfile::Builder::new().prefix(".reformany-table-")
        .tempdir_in(&folder).map_err(|e| e.to_string())?;
    let file = stage.path().join(format!("table.{}", job.target));
    if job.target == "xlsx" { write_xlsx(&rows, &file)?; }
    else { write_text(&rows, &job.target, &file)?; }
    let stem = source.file_stem().and_then(|s| s.to_str()).ok_or("Invalid table filename")?;
    publish(&file, &folder, stem, &job.target)
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn table_convert(job: TableJob) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || convert(job))
        .await.map_err(|_| "Spreadsheet conversion worker failed".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csv_tsv_json_are_roundtrippable_and_preserve_quoted_values() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("customers.csv");
        fs::write(&source, "\"00123\",\"New York, NY\"\n\"name\",\"line 1\nline 2\"\n").unwrap();
        let rows = load_text_table(&source, "csv").unwrap();
        assert_eq!(rows[0][0], "00123");
        assert_eq!(rows[1][1], "line 1\nline 2");
        let tsv = dir.path().join("test.tsv");
        write_text(&rows, "tsv", &tsv).unwrap();
        assert_eq!(load_text_table(&tsv, "tsv").unwrap(), rows);
        let json = dir.path().join("test.json");
        write_text(&rows, "json", &json).unwrap();
        assert_eq!(load_text_table(&json, "json").unwrap(), rows);
    }

    #[test]
    fn excel_writer_treats_formula_looking_inputs_as_literal_strings() {
        let dir = tempfile::tempdir().unwrap();
        let input = dir.path().join("literal.xlsx");
        write_xlsx(&[vec!["=HYPERLINK(\"https://example.com\")".into(), "000004".into()]], &input).unwrap();
        let rows = load_excel(&input).unwrap();
        assert_eq!(rows[0][0], "=HYPERLINK(\"https://example.com\")");
        assert_eq!(rows[0][1], "000004");
    }

    #[test]
    fn never_overwrites_original_table() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("report.csv");
        fs::write(&file, "name,qty\nWidget,12\n").unwrap();
        let output = convert(TableJob { path: file.to_string_lossy().into_owned(),
            target: "csv".into(), destination: None }).unwrap();
        assert_ne!(output, file.to_string_lossy());
        assert_eq!(fs::read_to_string(file).unwrap(), "name,qty\nWidget,12\n");
    }
}
