import * as fs from 'fs';
import mkdirp from 'mkdirp';

export function indentCode(code: string, chars: string) {
    const lines = code.split('\n').map(line => line.trimRight());
    return lines.map(line => chars + line).join('\n');
}

export function createDirectories(paths: string[]) {
    paths.forEach(path => mkdirp.sync(path));
}

export function writeFile(path: string, content: string) {
    fs.writeFileSync(path, content);
}