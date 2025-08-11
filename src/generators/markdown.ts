export class MarkdownBuilder {
    private code = '';

    public addTitle(title: string, level: 1 | 2 | 3 | 4) {
        const prefix = '#'.repeat(level);
        this.code += `${prefix} ${title}\n\n`;
    }

    public addParagraph(p: string) {
        this.code += `${p}\n\n`;
    }

    public addCode(code: string) {
        code = code.trim();
        if (code.startsWith('```')) {
            code = code.substring(3);
        }
        if (code.endsWith('```')) {
            code = code.substring(0, code.length - 3);
        }
        this.code += `\`\`\`tsx\n${code.trim()}\n\`\`\`\n\n`;
    }

    public addTable(table: any[]) {
        const tableFormat = (s: string) => {
            return s.replace(/\s+/g, ' ').replace(/\|/g, '\\|');
        };
        if (table.length === 0) return;
        const headers = Object.keys(table[0]);
        this.code += `|${headers.map(tableFormat).join('|')}|\n`;
        this.code += `|${headers.map(h => '-').join('|')}|\n`;
        for (const row of table) {
            this.code += `|${headers.map(h => tableFormat(row[h])).join('|')}|\n`;
        }
        this.code += '\n';
    }

    public toString() {
        return this.code;
    }
}