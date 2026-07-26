import * as vscode from 'vscode';
import { ScrumTeamParticipant } from './participant';

let participant: ScrumTeamParticipant;

export function activate(context: vscode.ExtensionContext) {
    participant = new ScrumTeamParticipant(context);
    context.subscriptions.push(participant.register());
}

export function deactivate() {}
