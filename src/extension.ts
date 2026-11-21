import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('taskbench.hello', () => {
      void vscode.window.showInformationMessage('Hello from Taskbench!');
    }),
  );
}

export function deactivate(): void {
  // Nothing to clean up yet.
}
