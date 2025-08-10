import * as clap from 'clap';
import { generateDocs, generateTypeDefinition } from '../index';
import { logError } from '../utils/logger';

export function main() {
    try {
        const cmd = clap
            .command('react-tsdoc')
            .description('Generate docs for React components')
            .version('0.0.1');

        cmd.command('types [input.ts] [output.t.ds]')
            .option('--module-name <name>')
            .action((actionArgs: { args: string[], options: any }) => {
                const { args, options } = actionArgs;
                generateTypeDefinition(args[0], args[1], options.moduleName);
            });

        cmd.command('docs [input.ts] [output-folder]')
            .option('--module-name <name>')
            .action((actionArgs: { args: string[], options: any }) => {
                const { args, options } = actionArgs;
                generateDocs(args[0], args[1], options.moduleName);
            });

        cmd.run();
    } catch (e) {
        logError(e);
    }
}