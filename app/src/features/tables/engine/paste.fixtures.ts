// checks-disable-file brand-consistency: colors and sizes here are clipboard CSS for other apps or test inputs, not design values.
// Clipboard HTML for the paste tests. These are small, hand-written copies of what each program puts on the
// clipboard, so they hold only what the reader uses: real captures would add megabytes of styling.

/** Excel for Windows in an English (United States) region, with a Windows clipboard header and a hidden row. */
export const EXCEL_EN = `Version:0.9
StartHTML:0000000105
EndHTML:0000003000
StartFragment:0000000200
EndFragment:0000002900
<html xmlns:o="urn:schemas-microsoft-com:office:office"
xmlns:x="urn:schemas-microsoft-com:office:excel"
xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta name=ProgId content=Excel.Sheet>
<style>
<!--table
	{mso-displayed-decimal-separator:"\\.";
	mso-displayed-thousand-separator:"\\,";}
.xl65
	{mso-number-format:"\\0022$\\0022\\#\\,\\#\\#0\\.00";}
.xl66
	{mso-number-format:0%;}
.xl67
	{mso-number-format:"Short Date";}
-->
</style>
</head>
<body>
<!--StartFragment-->
<table border=0 cellpadding=0 cellspacing=0 width=400 style='border-collapse:collapse;width:300pt'>
 <tr height=20 style='height:15.0pt'>
  <td height=20 width=64>Item</td><td width=64>Qty</td><td width=64>Price</td>
  <td width=64>Share</td><td width=64>Due</td><td width=64>Done</td><td width=64>Total</td>
 </tr>
 <tr height=20>
  <td height=20>Seed&nbsp;trays</td><td align=right x:num>12</td>
  <td class=xl65 align=right x:num="12.5">$12.50</td>
  <td class=xl66 align=right x:num="0.255">26%</td>
  <td class=xl67 align=right x:num="45565">9/30/2024</td>
  <td align=center x:bool="TRUE">TRUE</td>
  <td align=right x:num="150" x:fmla="=B2*C2">150</td>
 </tr>
 <tr height=20>
  <td height=20>Potting<br>soil</td><td align=right x:num="3">3</td>
  <td class=xl65 align=right x:num="1200">$1,200.00</td>
  <td class=xl66 align=right x:num="0.5">50%</td>
  <td class=xl67 align=right x:num="45566">10/1/2024</td>
  <td align=center x:bool="FALSE">FALSE</td>
  <td colspan=1 align=right x:num="3600" x:fmla="=B3*C3">3600</td>
 </tr>
 <![if !supportMisalignedColumns]>
 <tr height=0 style='display:none'>
  <td width=64 style='width:48pt'></td><td width=64 style='width:48pt'></td>
 </tr>
 <![endif]>
</table>
<!--EndFragment-->
</body>
</html>`;

/** Excel in a German region: shown text uses the comma decimal mark, and x:num holds the raw number. */
export const EXCEL_DE = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><style>
.xl70 {mso-number-format:"\\#\\,\\#\\#0\\.00\\\\ \\[$\\20AC-407\\]";}
</style></head><body><table>
<tr><td>Artikel</td><td>Preis</td><td>Menge</td></tr>
<tr><td>Erde</td><td class=xl70 x:num="1234.5">1.234,50 €</td><td x:num="1234.5">1.234,5</td></tr>
<tr><td>Samen</td><td class=xl70 x:num="3">3,00 €</td><td x:num="3">3</td></tr>
</table></body></html>`;

function quoted(value: unknown): string {
  return JSON.stringify(value).replace(/"/g, '&quot;');
}

function sheetsCell(value: unknown, shown: string, format?: string): string {
  const pattern = format ? ` data-sheets-numberformat="${quoted({ 1: 2, 2: format })}"` : '';
  return `<td data-sheets-value="${quoted(value)}"${pattern}>${shown}</td>`;
}

/** Google Sheets as Edge receives it: typed values in data-sheets-value, and the format pattern beside them. */
export function sheetsTable(): string {
  const text = (s: string): string => sheetsCell({ 1: 2, 2: s }, s);
  const rate = (n: number, shown: string): string => sheetsCell({ 1: 3, 3: n }, shown, '0.00%');
  const qty = (n: number): string => sheetsCell({ 1: 3, 3: n }, String(n));
  const rows = [
    `<tr>${text('Rate')}${text('Qty')}</tr>`,
    `<tr>${rate(0.5, '50.00%')}${qty(4)}</tr>`,
    `<tr>${rate(0.25, '25.00%')}${qty(6)}</tr>`,
  ];
  return `<google-sheets-html-origin><table>${rows.join('')}</table></google-sheets-html-origin>`;
}

/** LibreOffice Calc: sdval holds the raw value, and the third part of sdnum is the format code. */
export const CALC_TABLE = `<html><head><meta name="generator" content="LibreOffice"></head><body><table>
<tr><td>When</td><td>Amount</td></tr>
<tr><td sdval="45565" sdnum="1033;1033;MM/DD/YYYY">09/30/2024</td><td sdval="12.5" sdnum="1033;0;0.00">12.50</td></tr>
<tr><td sdval="45566" sdnum="1033;1033;MM/DD/YYYY">10/01/2024</td><td sdval="7" sdnum="1033;0;0.00">7.00</td></tr>
</table></body></html>`;

/**
 * Excel with formats and a formula (tables clipboard, ADR 0067). Hand-written from the Office HTML clipboard format:
 * a style block with the Normal style on `td` and one class per cell format, `x:num` raw numbers, and `x:fmla`
 * formulas in A1 form. A1 is a bold red title, A2 and A3 use `#,##0.00`, and A4 is `=SUM(A2:A3)`.
 */
export const EXCEL_STYLED = `Version:0.9
StartHTML:0000000105
EndHTML:0000001500
StartFragment:0000000400
EndFragment:0000001400
<html xmlns:o="urn:schemas-microsoft-com:office:office"
xmlns:x="urn:schemas-microsoft-com:office:excel"
xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta name=ProgId content=Excel.Sheet>
<style>
<!--table
	{mso-displayed-decimal-separator:"\\.";
	mso-displayed-thousand-separator:"\\,";}
td
	{padding-top:1px;
	color:black;
	font-size:11.0pt;
	font-weight:400;
	font-family:Calibri, sans-serif;
	mso-number-format:General;
	vertical-align:bottom;
	border:none;
	white-space:nowrap;}
.xl65
	{color:red;
	font-weight:700;}
.xl66
	{mso-number-format:"\\#\\,\\#\\#0\\.00";}
-->
</style>
</head>
<body>
<!--StartFragment-->
<table border=0 cellpadding=0 cellspacing=0 width=64 style='border-collapse:collapse;width:48pt'>
 <col width=64 style='width:48pt'>
 <tr height=20 style='height:15.0pt'>
  <td height=20 class=xl65 width=64 style='height:15.0pt;width:48pt'>Amount</td>
 </tr>
 <tr height=20 style='height:15.0pt'>
  <td height=20 class=xl66 align=right x:num="1234.5">1,234.50</td>
 </tr>
 <tr height=20 style='height:15.0pt'>
  <td height=20 class=xl66 align=right x:num="10">10.00</td>
 </tr>
 <tr height=20 style='height:15.0pt'>
  <td height=20 class=xl66 align=right x:num="1244.5" x:fmla="=SUM(A2:A3)">1,244.50</td>
 </tr>
<!--EndFragment-->
</table>
</body>
</html>`;

/**
 * Google Sheets with a formula (tables clipboard, ADR 0067): numbers in A1 and A2, and A3 holding `=A1+A2`, which
 * Sheets writes in R1C1 form in `data-sheets-formula`. Hand-written from that attribute's documented form.
 */
export function sheetsFormulaTable(): string {
  const style = 'style="overflow:hidden;padding:2px 3px;vertical-align:bottom;"';
  const value = (n: number): string => `data-sheets-value="${quoted({ 1: 3, 3: n })}"`;
  const num = (n: number): string => `<td ${style} ${value(n)}>${n}</td>`;
  const sum = `<td ${style} ${value(5)} data-sheets-formula="=R[-2]C[0]+R[-1]C[0]">5</td>`;
  return (
    '<meta charset="utf-8"><google-sheets-html-origin><style type="text/css"><!--td {border: 1px solid #cccccc;}--></style>' +
    `<table xmlns="http://www.w3.org/1999/xhtml" cellspacing="0" cellpadding="0" dir="ltr" border="1" data-sheets-root="1">` +
    `<colgroup><col width="100"></colgroup><tbody><tr>${num(2)}</tr><tr>${num(3)}</tr><tr>${sum}</tr></tbody></table>` +
    '</google-sheets-html-origin>'
  );
}
