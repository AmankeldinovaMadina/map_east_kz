import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read the new Excel file
const workbook = XLSX.readFile(path.join(__dirname, '../src/assets/new_excel.xlsx'));
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];

// Convert to JSON
const jsonData = XLSX.utils.sheet_to_json(worksheet);

// Save to JSON file
const outputPath = path.join(__dirname, '../src/assets/excel-data.json');
fs.writeFileSync(outputPath, JSON.stringify(jsonData, null, 2));

console.log('Excel file converted to JSON successfully!');
console.log('Output file:', outputPath);
console.log('Sample data:', JSON.stringify(jsonData.slice(0, 3), null, 2));
