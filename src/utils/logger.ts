import chalk from 'chalk';

export function logCompilerMessage(message: string) {
    console.error(chalk.gray(`[TypeScript] ${message}`));
}

export function logDebug(...objects: any[]) {
    console.log(chalk.gray(...objects));
}

export function logInfo(...objects: any[]) {
    console.log(chalk.green(...objects));
}

export function logWarning(...objects: any[]) {
    console.log(chalk.redBright(...objects));
}

export function logError(...objects: any[]) {
    console.log(chalk.redBright(...objects));
}