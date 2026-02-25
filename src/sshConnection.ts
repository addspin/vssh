import * as vscode from 'vscode';
import * as fs from 'fs';
import { ServerConfig, GatewayConfig } from './types';

export class SSHConnection {
    private server: ServerConfig;
    private terminal: vscode.Terminal | undefined;

    constructor(server: ServerConfig) {
        this.server = server;
    }

    async connect(): Promise<void> {
        // Строим SSH команду
        const sshArgs: string[] = [];

        // Порт
        sshArgs.push('-p', this.server.port.toString());

        // Пользователь
        sshArgs.push('-l', this.server.username);

        // Ключ аутентификации
        if (this.server.authMethod === 'privateKey' && this.server.privateKeyPath) {
            sshArgs.push('-i', this.server.privateKeyPath);
        }

        // Отключаем строгую проверку хоста для удобства
        sshArgs.push('-o', 'StrictHostKeyChecking=no');
        sshArgs.push('-o', 'UserKnownHostsFile=/dev/null');

        // Настройка Gateway (Jump Host)
        if (this.server.gateway) {
            const gateway = this.server.gateway;
            const gatewayString = `${gateway.username}@${gateway.host}:${gateway.port}`;
            
            // ProxyCommand для подключения через gateway
            let gatewayAuthArgs = '';
            
            if (gateway.authMethod === 'privateKey' && gateway.privateKeyPath) {
                gatewayAuthArgs = `-i ${gateway.privateKeyPath}`;
            } else if (gateway.authMethod === 'password' && gateway.password) {
                // Проверяем sshpass для gateway
                const hasSshpass = await this.checkSshpass();
                if (hasSshpass) {
                    const escapedGatewayPassword = gateway.password.replace(/'/g, "'\\''");
                    gatewayAuthArgs = `-o "ProxyCommand=sshpass -p '${escapedGatewayPassword}' ssh -W %h:%p -p ${gateway.port} -o StrictHostKeyChecking=no ${gateway.username}@${gateway.host}"`;
                } else {
                    vscode.window.showWarningMessage(
                        'sshpass не найден. Для подключения через Gateway с паролем требуется sshpass. Установите: brew install sshpass (macOS) или apt install sshpass (Linux)'
                    );
                    gatewayAuthArgs = `-o "ProxyCommand=ssh -W %h:%p -p ${gateway.port} ${gateway.username}@${gateway.host}"`;
                }
            }
            
            if (gateway.authMethod === 'privateKey' || (gateway.authMethod === 'password' && await this.checkSshpass())) {
                sshArgs.push(gatewayAuthArgs);
            } else if (gateway.authMethod === 'password') {
                // Альтернативный способ через -J (SSH ProxyJump)
                sshArgs.push('-J', `${gateway.username}@${gateway.host}:${gateway.port}`);
            }
        }

        // Хост
        sshArgs.push(this.server.host);

        // Формируем SSH команду
        let sshCommand: string;

        // Если используется аутентификация по паролю и пароль сохранён
        if (this.server.authMethod === 'password' && this.server.password) {
            const hasSshpass = await this.checkSshpass();
            if (hasSshpass) {
                const escapedPassword = this.server.password.replace(/'/g, "'\\''");
                sshCommand = `sshpass -p '${escapedPassword}' ssh ${sshArgs.join(' ')}`;
            } else {
                vscode.window.showWarningMessage(
                    'sshpass не найден. SSH запросит пароль вручную.'
                );
                sshCommand = `ssh ${sshArgs.join(' ')}`;
            }
        } else {
            sshCommand = `ssh ${sshArgs.join(' ')}`;
        }

        // Определяем оболочку по умолчанию для платформы
        const isWindows = process.platform === 'win32';
        const shellPath = isWindows ? 'powershell.exe' : '/bin/bash';
        const shellArgs = isWindows 
            ? ['-Command', sshCommand]
            : ['-c', sshCommand];

        // Создаем терминал с оболочкой по умолчанию
        this.terminal = vscode.window.createTerminal({
            name: `SSH: ${this.server.name}`,
            shellPath: shellPath,
            shellArgs: shellArgs
        });

        this.terminal.show();

        vscode.window.showInformationMessage(`Подключение к ${this.server.name}${this.server.gateway ? ` через ${this.server.gateway.host}` : ''}...`);
    }

    private async checkSshpass(): Promise<boolean> {
        try {
            const { exec } = require('child_process');
            return await new Promise((resolve) => {
                exec('command -v sshpass', (error: any) => {
                    resolve(!error);
                });
            });
        } catch {
            return false;
        }
    }

    disconnect(): void {
        if (this.terminal) {
            this.terminal.dispose();
            this.terminal = undefined;
        }
    }
}
