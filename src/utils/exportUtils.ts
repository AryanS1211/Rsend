import type { ChartConfig, DataSource } from '../types';

export function exportCSV(data: Record<string, unknown>[], filename: string) {
  if (data.length === 0) return;
  const headers = Object.keys(data[0]);
  const rows = [
    headers.join(','),
    ...data.map(row =>
      headers.map(h => {
        const val = row[h];
        const str = val === null || val === undefined ? '' : String(val);
        return str.includes(',') ? `"${str}"` : str;
      }).join(',')
    ),
  ];
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportXLSX(data: Record<string, unknown>[], filename: string) {
  const { utils, writeFile } = await import('xlsx');
  const ws = utils.json_to_sheet(data);
  const wb = utils.book_new();
  utils.book_append_sheet(wb, ws, 'Data');
  writeFile(wb, filename);
}

export async function exportPDF(
  reportName: string,
  charts: ChartConfig[],
  ds: DataSource,
  userEmail: string
) {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF();

  // Header
  doc.setFontSize(22);
  doc.setTextColor(99, 102, 241);
  doc.text('Rsend', 14, 20);

  doc.setFontSize(16);
  doc.setTextColor(30, 41, 59);
  doc.text(reportName, 14, 32);

  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text(`Generated: ${new Date().toLocaleDateString()}  |  Data source: ${ds.name}  |  ${userEmail}`, 14, 42);

  doc.setDrawColor(99, 102, 241);
  doc.setLineWidth(0.5);
  doc.line(14, 46, 196, 46);

  // Charts list
  let y = 56;
  doc.setFontSize(13);
  doc.setTextColor(30, 41, 59);
  doc.text('Report Charts', 14, y);
  y += 8;
  charts.forEach((c, i) => {
    doc.setFontSize(10);
    doc.setTextColor(99, 102, 241);
    doc.text(`${i + 1}. ${c.title} (${c.type})`, 18, y);
    y += 6;
    if (c.xAxis) {
      doc.setTextColor(100, 116, 139);
      doc.text(`   X: ${c.xAxis}  |  Y: ${c.yAxes.join(', ')}`, 18, y);
      y += 6;
    }
    y += 2;
  });

  y += 6;

  // Data table (first 30 rows)
  const headers = ds.columns.map(c => c.name);
  const rows = ds.data.slice(0, 30).map(row => headers.map(h => String(row[h] ?? '')));
  autoTable(doc, {
    head: [headers],
    body: rows,
    startY: y,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [99, 102, 241], textColor: 255 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });

  doc.save(`${reportName.replace(/\s+/g, '_')}.pdf`);
}
