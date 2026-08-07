/**
 * Rehydrates the compressed template workbook (excel_schema.js `excelData`)
 * into a real ExcelJS workbook: sparse cells plus a shared style map, which
 * is what keeps a fully-formatted multi-sheet template down to one constant.
 */

class ExcelTemplate {
  constructor(compressedData) {
    this.compressed = compressedData;
  }

  createWorkbook(ExcelJS) {
    const workbook = new ExcelJS.Workbook();

    Object.entries(this.compressed.s).forEach(([sheetName, sheet]) => {
      const worksheet = workbook.addWorksheet(sheetName);

      // Restore data from sparse format
      sheet.d.forEach(([rowIndex, colIndex, value]) => {
        const cell = worksheet.getCell(rowIndex + 1, colIndex + 1);
        cell.value = value;
      });

      // Apply styles using global style map
      if (sheet.st) {
        Object.entries(sheet.st).forEach(([ref, styleId]) => {
          const cell = worksheet.getCell(ref);
          const style = this.compressed.st[styleId];

          if (style.f) {
            cell.font = {
              bold: style.f.b,
              italic: style.f.i,
              underline: style.f.u,
              strike: style.f.s,
              size: style.f.sz || 11,
              name: style.f.n || 'Calibri',
              color: style.f.c && { argb: 'FF' + style.f.c },
            };
          }

          if (style.fill) {
            cell.fill = {
              type: 'pattern',
              pattern: style.fill.p || 'solid',
              fgColor: style.fill.fg && { argb: 'FF' + style.fill.fg },
              bgColor: style.fill.bg && { argb: 'FF' + style.fill.bg },
            };
          }

          if (style.b) {
            const border = {};
            const sides = ['top', 'bottom', 'left', 'right'];
            const keys = ['t', 'b', 'l', 'r'];
            keys.forEach((key, idx) => {
              if (style.b[key]) {
                border[sides[idx]] = {
                  style: style.b[key][0],
                  color: { argb: 'FF' + style.b[key][1] },
                };
              }
            });
            cell.border = border;
          }

          if (style.a) {
            cell.alignment = {
              horizontal: style.a.h,
              vertical: style.a.v,
              wrapText: style.a.w,
            };
          }

          if (style.nf) {
            cell.numFmt = style.nf;
          }
        });
      }
    });

    return workbook;
  }
}

export { ExcelTemplate };
