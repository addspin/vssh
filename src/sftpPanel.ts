import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ServerConfig } from './types';
import SftpClient from 'ssh2-sftp-client';

export class SftpPanel {
    public static currentPanel: SftpPanel | undefined;
    public static readonly viewType = 'vsshSftp';

    private readonly _panel: vscode.WebviewPanel;
    private _server: ServerConfig;
    private _disposables: vscode.Disposable[] = [];
    private _sftp: SftpClient | null = null;
    private _currentPath: string = '';

    public static createOrShow(extensionUri: vscode.Uri, server: ServerConfig) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // Если панель уже открыта - показываем её
        if (SftpPanel.currentPanel) {
            SftpPanel.currentPanel._panel.reveal(column);
            SftpPanel.currentPanel._server = server;
            SftpPanel.currentPanel._connect();
            return;
        }

        // Создаем новую панель
        const panel = vscode.window.createWebviewPanel(
            SftpPanel.viewType,
            `SFTP: ${server.name}`,
            column || vscode.ViewColumn.Two,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri]
            }
        );

        SftpPanel.currentPanel = new SftpPanel(panel, extensionUri, server);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, server: ServerConfig) {
        this._panel = panel;
        this._server = server;
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        
        this._panel.webview.html = this._getHtmlForWebview();
        this._setupWebviewMessageListener();
        
        this._connect();
    }

    private async _connect(): Promise<void> {
        try {
            this._sftp = new SftpClient();
            await this._sftp.connect({
                host: this._server.host,
                port: this._server.port,
                username: this._server.username,
                privateKey: this._server.privateKeyPath 
                    ? fs.readFileSync(this._server.privateKeyPath) 
                    : undefined,
                password: this._server.authMethod === 'password' ? undefined : undefined
            });
            
            this._currentPath = '';
            await this._listDirectory('/');
        } catch (error) {
            vscode.window.showErrorMessage(`Ошибка подключения SFTP: ${error}`);
            this._panel.webview.postMessage({ command: 'error', message: String(error) });
        }
    }

    private async _listDirectory(remotePath: string): Promise<void> {
        if (!this._sftp) return;

        try {
            const list = await this._sftp.list(remotePath);
            this._currentPath = remotePath;
            
            this._panel.webview.postMessage({
                command: 'list',
                path: remotePath,
                files: list.map((item: any) => ({
                    name: item.name,
                    type: item.type === 'd' ? 'folder' : 'file',
                    size: item.size,
                    modifyTime: item.modifyTime
                }))
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Ошибка чтения директории: ${error}`);
        }
    }

    private async _downloadFile(remotePath: string): Promise<void> {
        if (!this._sftp) return;

        try {
            const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(path.basename(remotePath))
            });

            if (uri) {
                await this._sftp.get(remotePath, fs.createWriteStream(uri.fsPath));
                vscode.window.showInformationMessage(`Файл загружен: ${uri.fsPath}`);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Ошибка загрузки: ${error}`);
        }
    }

    private async _uploadFile(localPath: string, remotePath: string): Promise<void> {
        if (!this._sftp) return;

        try {
            const destPath = path.posix.join(remotePath, path.basename(localPath));
            await this._sftp.put(fs.createReadStream(localPath), destPath);
            vscode.window.showInformationMessage(`Файл загружен: ${destPath}`);
            await this._listDirectory(remotePath);
        } catch (error) {
            vscode.window.showErrorMessage(`Ошибка загрузки: ${error}`);
        }
    }

    private _getHtmlForWebview(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SFTP Browser</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            padding: 10px;
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
        }
        .header {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 15px;
            padding: 10px;
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 4px;
        }
        .path {
            flex: 1;
            font-family: monospace;
            padding: 5px 10px;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
        }
        .btn {
            padding: 5px 12px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 3px;
            cursor: pointer;
        }
        .btn:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .file-list {
            list-style: none;
            padding: 0;
            margin: 0;
        }
        .file-item {
            display: flex;
            align-items: center;
            padding: 8px 10px;
            cursor: pointer;
            border-radius: 3px;
        }
        .file-item:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .file-icon {
            margin-right: 8px;
            font-size: 16px;
        }
        .file-name {
            flex: 1;
        }
        .file-size {
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
            margin-left: 10px;
        }
        .drop-zone {
            border: 2px dashed var(--vscode-input-border);
            border-radius: 4px;
            padding: 20px;
            text-align: center;
            margin-top: 10px;
            color: var(--vscode-descriptionForeground);
        }
        .drop-zone.dragover {
            border-color: var(--vscode-button-background);
            background: var(--vscode-list-dropBackground);
        }
        .error {
            color: var(--vscode-errorForeground);
            padding: 10px;
            background: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            border-radius: 3px;
            margin-bottom: 10px;
        }
    </style>
</head>
<body>
    <div class="header">
        <button class="btn" id="backBtn">⬆ Наверх</button>
        <div class="path" id="currentPath">/</div>
        <button class="btn" id="refreshBtn">⟳ Обновить</button>
        <button class="btn" id="uploadBtn">📤 Загрузить</button>
    </div>
    <div id="errorContainer"></div>
    <ul class="file-list" id="fileList"></ul>
    <div class="drop-zone" id="dropZone">
        Перетащите файлы сюда для загрузки
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let currentPath = '/';

        document.getElementById('backBtn').addEventListener('click', () => {
            if (currentPath !== '/') {
                const parent = currentPath.split('/').slice(0, -1).join('/') || '/';
                vscode.postMessage({ command: 'list', path: parent });
            }
        });

        document.getElementById('refreshBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'list', path: currentPath });
        });

        document.getElementById('uploadBtn').addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.multiple = true;
            input.onchange = (e) => {
                const files = e.target.files;
                if (files) {
                    for (let file of files) {
                        vscode.postMessage({ command: 'upload', path: currentPath, file: file.name });
                    }
                }
            };
            input.click();
        });

        const dropZone = document.getElementById('dropZone');
        
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });

        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('dragover');
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            
            const files = e.dataTransfer.files;
            if (files) {
                for (let file of files) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        vscode.postMessage({ 
                            command: 'uploadFile', 
                            path: currentPath, 
                            fileName: file.name,
                            content: event.target.result
                        });
                    };
                    reader.readAsArrayBuffer(file);
                }
            }
        });

        window.addEventListener('message', event => {
            const message = event.data;
            
            if (message.command === 'list') {
                currentPath = message.path;
                document.getElementById('currentPath').textContent = message.path;
                renderFileList(message.files);
            }
            
            if (message.command === 'error') {
                document.getElementById('errorContainer').innerHTML = 
                    '<div class="error">' + message.message + '</div>';
            }
        });

        function renderFileList(files) {
            const list = document.getElementById('fileList');
            list.innerHTML = '';

            files.forEach(file => {
                const li = document.createElement('li');
                li.className = 'file-item';
                
                const icon = file.type === 'folder' ? '📁' : '📄';
                li.innerHTML = \`
                    <span class="file-icon">\${icon}</span>
                    <span class="file-name">\${file.name}</span>
                    <span class="file-size">\${formatSize(file.size)}</span>
                \`;
                
                li.addEventListener('click', () => {
                    if (file.type === 'folder') {
                        const newPath = currentPath === '/' 
                            ? '/' + file.name 
                            : currentPath + '/' + file.name;
                        vscode.postMessage({ command: 'list', path: newPath });
                    } else {
                        vscode.postMessage({ command: 'download', path: currentPath + '/' + file.name });
                    }
                });
                
                list.appendChild(li);
            });
        }

        function formatSize(bytes) {
            if (bytes === 0) return '0 B';
            const k = 1024;
            const sizes = ['B', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
        }
    </script>
</body>
</html>`;
    }

    private _setupWebviewMessageListener(): void {
        this._panel.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'list':
                    await this._listDirectory(message.path);
                    break;
                case 'download':
                    await this._downloadFile(message.path);
                    break;
                case 'upload':
                    // Для загрузки через диалог
                    const uris = await vscode.window.showOpenDialog({
                        canSelectFiles: true,
                        canSelectFolders: false,
                        canSelectMany: true
                    });
                    if (uris) {
                        for (const uri of uris) {
                            await this._uploadFile(uri.fsPath, message.path);
                        }
                    }
                    break;
            }
        }, null, this._disposables);
    }

    public dispose() {
        SftpPanel.currentPanel = undefined;
        this._panel.dispose();
        
        if (this._sftp) {
            this._sftp.end();
            this._sftp = null;
        }
        
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) x.dispose();
        }
    }
}
