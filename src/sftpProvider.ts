import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ServerConfig } from './types';
import SftpClient from 'ssh2-sftp-client';

export class SftpFileItem extends vscode.TreeItem {
    constructor(
        public readonly filePath: string,
        public readonly fileType: 'file' | 'folder',
        public readonly fileSize: number,
        private readonly sftpProvider: SftpProvider
    ) {
        super(path.basename(filePath), fileType === 'folder' 
            ? vscode.TreeItemCollapsibleState.Collapsed 
            : vscode.TreeItemCollapsibleState.None);
        
        // Иконки с цветами через resourceUri
        if (fileType === 'folder') {
            // Синяя папка
            this.resourceUri = vscode.Uri.parse('folder:' + filePath);
            this.iconPath = new vscode.ThemeIcon('folder', new vscode.ThemeColor('charts.blue'));
        } else {
            // Белый файл
            this.resourceUri = vscode.Uri.parse('file:' + filePath);
            this.iconPath = new vscode.ThemeIcon('file', new vscode.ThemeColor('foreground'));
        }
        
        this.contextValue = fileType === 'folder' ? 'sftpFolder' : 'sftpFile';
        this.description = fileType === 'file' ? this.formatSize(fileSize) : '';
        
        // При клике на папку - выбираем её как целевую для создания файлов
        this.command = {
            command: 'vssh.sftpSelectItem',
            title: 'Select Item',
            arguments: [this]
        };
    }
    
    private formatSize(bytes: number): string {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }
}

export class SftpProvider implements vscode.TreeDataProvider<SftpFileItem>, vscode.TreeDragAndDropController<SftpFileItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<SftpFileItem | undefined | null | void> = new vscode.EventEmitter();
    readonly onDidChangeTreeData: vscode.Event<SftpFileItem | undefined | null | void> = this._onDidChangeTreeData.event;

    dropMimeTypes: readonly string[] = ['text/uri-list', 'Files'];
    dragMimeTypes: readonly string[] = [];

    private _sftp: SftpClient | null = null;
    private _currentPath: string = '';
    private _server: ServerConfig | null = null;
    private _cache: Map<string, SftpFileItem[]> = new Map();
    private _connecting: boolean = false;
    private _selectedPath: string = '/';
    private _openDocuments: Map<string, { content: string; path: string; version: number }> = new Map();

    constructor() {
        // Отслеживаем сохранения документов
        vscode.workspace.onDidSaveTextDocument((document) => {
            this.handleDocumentSave(document);
        });
    }

    async connect(server: ServerConfig): Promise<void> {
        // Если уже подключены к тому же серверу, просто показываем view
        if (this._server && this._server.host === server.host && this._sftp) {
            vscode.commands.executeCommand('setContext', 'vsshSftpConnected', true);
            vscode.commands.executeCommand('vsshSftp.focus');
            return;
        }

        // Если уже идёт подключение, ждём
        if (this._connecting) {
            vscode.window.showWarningMessage('Подключение уже выполняется...');
            return;
        }

        this._connecting = true;
        this._cache.clear();

        try {
            if (this._sftp) {
                await this._sftp.end();
            }

            this._sftp = new SftpClient();
            
            const config: any = {
                host: server.host,
                port: server.port,
                username: server.username,
            };

            if (server.authMethod === 'privateKey' && server.privateKeyPath) {
                config.privateKey = fs.readFileSync(server.privateKeyPath);
            } else if (server.authMethod === 'password' && server.password) {
                config.password = server.password;
            }

            // Попытка подключения с retry (максимум 2 попытки)
            let lastError: any = null;
            for (let attempt = 1; attempt <= 2; attempt++) {
                try {
                    await this._sftp.connect(config);
                    break; // Успех
                } catch (error: any) {
                    lastError = error;
                    if (attempt === 1) {
                        vscode.window.showWarningMessage(`Попытка подключения не удалась, повтор... (${attempt}/2)`);
                        await new Promise(resolve => setTimeout(resolve, 1000)); // Пауза 1 секунда
                    }
                }
            }

            if (!this._sftp) {
                throw lastError || new Error('Не удалось подключиться после 2 попыток');
            }

            this._server = server;

            // Пытаемся определить домашнюю директорию
            let connected = false;
            
            // Сначала пробуем стандартные пути
            const pathsToTry = [
                `/home/${server.username}`,      // Linux
                `/Users/${server.username}`,     // macOS
                `/Users/${server.username}`,     // macOS (повтор для надёжности)
            ];

            for (const testPath of pathsToTry) {
                try {
                    await this._sftp.stat(testPath);
                    this._currentPath = testPath;
                    connected = true;
                    console.log('vSSH SFTP: Found home directory', testPath);
                    break;
                } catch (error: any) {
                    console.log('vSSH SFTP: Path not found', testPath, error.message);
                    continue;
                }
            }
            
            // Если ни один путь не найден, пробуем получить рабочую директорию через exec
            if (!connected) {
                try {
                    // Пытаемся выполнить pwd через ssh2 (если поддерживается)
                    this._currentPath = '/';
                    connected = true;
                } catch {
                    this._currentPath = '/';
                }
            }
            
            // Если ни одна директория не найдена, используем корень
            if (!connected) {
                this._currentPath = '/';
                console.log('vSSH SFTP: Using root directory /');
            }

            console.log('vSSH SFTP: Connected to', this._currentPath);

            // Устанавливаем контекст для отображения view
            vscode.commands.executeCommand('setContext', 'vsshSftpConnected', true);

            this.refresh();
            vscode.window.showInformationMessage(`SFTP подключен к ${server.host}:${this._currentPath}`);
            vscode.commands.executeCommand('vsshSftp.focus');
        } catch (error) {
            vscode.window.showErrorMessage(`Ошибка подключения SFTP: ${error}`);
            this.disconnect();
        } finally {
            this._connecting = false;
        }
    }

    disconnect(): void {
        if (this._sftp) {
            this._sftp.end();
            this._sftp = null;
        }
        this._server = null;
        this._selectedPath = '/';
        this._currentPath = '/';
        this._cache.clear();
        vscode.commands.executeCommand('setContext', 'vsshSftpConnected', false);
        this.refresh();
        vscode.window.showInformationMessage('SFTP отключен');
    }

    refresh(): void {
        this._cache.clear();
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: SftpFileItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: SftpFileItem): Promise<SftpFileItem[]> {
        if (!this._sftp || !this._server) {
            return [];
        }

        const dirPath = element ? element.filePath : this._currentPath;

        // Проверяем кэш
        const cached = this._cache.get(dirPath);
        if (cached) {
            return cached;
        }

        try {
            const list = await this._sftp.list(dirPath);
            const items = list.map(item => {
                const fullPath = path.posix.join(dirPath, item.name);
                return new SftpFileItem(
                    fullPath,
                    item.type === 'd' ? 'folder' : 'file',
                    item.size || 0,
                    this
                );
            });

            // Кэшируем результат
            this._cache.set(dirPath, items);
            return items;
        } catch (error: any) {
            console.error('vSSH SFTP: Error listing directory', error);
            return [];
        }
    }

    setSelectedPath(filePath: string): void {
        this._selectedPath = filePath;
        console.log('vSSH SFTP: Selected path set to', filePath);
    }

    getSelectedPath(): string {
        return this._selectedPath;
    }

    async downloadFile(filePath: string): Promise<void> {
        if (!this._sftp) {
            vscode.window.showErrorMessage('SFTP не подключен');
            return;
        }

        console.log('vSSH SFTP: Downloading', filePath);

        try {
            const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(path.basename(filePath))
            });

            if (!uri) {
                return;
            }

            console.log('vSSH SFTP: Saving to', uri.fsPath);
            await this._sftp.get(filePath, fs.createWriteStream(uri.fsPath));
            vscode.window.showInformationMessage(`Файл загружен: ${uri.fsPath}`);
        } catch (error: any) {
            console.error('vSSH SFTP: Download error', error);
            vscode.window.showErrorMessage(`Ошибка загрузки: ${error.message}`);
        }
    }

    async openFile(filePath: string): Promise<void> {
        if (!this._sftp) {
            vscode.window.showErrorMessage('SFTP не подключен');
            return;
        }

        try {
            console.log('vSSH SFTP: Opening file', filePath);

            // Скачиваем содержимое файла во временную директорию
            const tempDir = path.join(require('os').tmpdir(), 'vssh');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            const tempFile = path.join(tempDir, path.basename(filePath));
            await this._sftp.get(filePath, fs.createWriteStream(tempFile));

            // Открываем файл в редакторе
            const uri = vscode.Uri.file(tempFile);
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc, { preview: false });

            // Сохраняем информацию о файле для последующего обновления
            const content = fs.readFileSync(tempFile, 'utf-8');
            this._openDocuments.set(uri.fsPath, {
                content,
                path: filePath,
                version: doc.version
            });

            vscode.window.showInformationMessage(`Файл открыт: ${path.basename(filePath)}`);
        } catch (error: any) {
            console.error('vSSH SFTP: Open file error', error);
            vscode.window.showErrorMessage(`Ошибка открытия файла: ${error.message}`);
        }
    }

    async handleDocumentSave(document: vscode.TextDocument): Promise<void> {
        const docInfo = this._openDocuments.get(document.uri.fsPath);
        if (!docInfo || !this._sftp) {
            return;
        }

        try {
            console.log('vSSH SFTP: Saving file', docInfo.path);

            // Проверяем, изменилось ли содержимое
            const newContent = document.getText();
            if (newContent === docInfo.content) {
                return; // Содержимое не изменилось
            }

            // Создаём временный файл с новым содержимым
            const tempFile = document.uri.fsPath;
            fs.writeFileSync(tempFile, newContent, 'utf-8');

            // Загружаем файл обратно на сервер
            await this._sftp.put(fs.createReadStream(tempFile), docInfo.path);

            // Обновляем кэш
            docInfo.content = newContent;
            docInfo.version = document.version;
            this._openDocuments.set(document.uri.fsPath, docInfo);

            vscode.window.showInformationMessage(`Файл сохранён: ${path.basename(docInfo.path)}`);
        } catch (error: any) {
            console.error('vSSH SFTP: Save file error', error);
            vscode.window.showErrorMessage(`Ошибка сохранения: ${error.message}`);
        }
    }

    async downloadFolder(folderPath: string): Promise<void> {
        if (!this._sftp) {
            vscode.window.showErrorMessage('SFTP не подключен');
            return;
        }

        try {
            // Выбираем директорию для сохранения
            const saveUri = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                title: 'Выберите директорию для сохранения'
            });

            if (!saveUri || saveUri.length === 0) {
                return; // Пользователь отменил
            }

            const savePath = saveUri[0].fsPath;
            const folderName = path.basename(folderPath);
            const localFolder = path.join(savePath, folderName);

            console.log('vSSH SFTP: Downloading folder', folderPath, 'to', localFolder);

            // Создаём локальную папку
            if (!fs.existsSync(localFolder)) {
                fs.mkdirSync(localFolder, { recursive: true });
            }

            // Рекурсивно скачиваем содержимое
            await this._downloadRecursive(folderPath, localFolder);

            vscode.window.showInformationMessage(`Папка загружена: ${localFolder}`);
        } catch (error: any) {
            console.error('vSSH SFTP: Download folder error', error);
            vscode.window.showErrorMessage(`Ошибка загрузки папки: ${error.message}`);
        }
    }

    private async _downloadRecursive(remotePath: string, localPath: string): Promise<void> {
        const list = await this._sftp!.list(remotePath);

        for (const item of list) {
            const remoteItemPath = path.posix.join(remotePath, item.name);
            const localItemPath = path.join(localPath, item.name);

            if (item.type === 'd') {
                // Это папка
                if (!fs.existsSync(localItemPath)) {
                    fs.mkdirSync(localItemPath, { recursive: true });
                }
                await this._downloadRecursive(remoteItemPath, localItemPath);
            } else {
                // Это файл
                console.log('vSSH SFTP: Downloading file', remoteItemPath);
                await this._sftp!.get(remoteItemPath, fs.createWriteStream(localItemPath));
            }
        }
    }

    async deleteFile(filePath: string): Promise<void> {
        if (!this._sftp) return;

        const confirm = await vscode.window.showWarningMessage(
            `Удалить ${path.basename(filePath)}?`,
            { modal: true },
            'Удалить'
        );

        if (!confirm) return;

        try {
            const stat = await this._sftp.stat(filePath);
            if ((stat as any).type === 'd') {
                await this._sftp.rmdir(filePath, true);
            } else {
                await this._sftp.delete(filePath);
            }
            this.refresh();
            vscode.window.showInformationMessage('Файл удалён');
        } catch (error) {
            vscode.window.showErrorMessage(`Ошибка удаления: ${error}`);
        }
    }

    async createFolder(folderName: string): Promise<void> {
        if (!this._sftp) {
            vscode.window.showErrorMessage('SFTP не подключен');
            return;
        }

        // Используем выбранную папку или текущий путь
        const targetPath = this._selectedPath || this._currentPath;
        
        console.log('vSSH SFTP: Creating folder in', targetPath);

        try {
            const fullPath = path.posix.join(targetPath, folderName);
            await this._sftp.mkdir(fullPath);
            this._cache.delete(targetPath); // Очищаем кэш целевой папки
            this.refresh();
            vscode.window.showInformationMessage(`Папка "${folderName}" создана в ${targetPath}`);
        } catch (error: any) {
            console.error('vSSH SFTP: Create folder error', error);
            vscode.window.showErrorMessage(`Ошибка создания папки: ${error.message}`);
        }
    }

    async uploadFiles(uris: vscode.Uri[]): Promise<void> {
        if (!this._sftp) {
            vscode.window.showErrorMessage('SFTP не подключен');
            return;
        }

        if (!uris || uris.length === 0) {
            return;
        }

        // Используем выбранную папку или текущий путь
        const targetPath = this._selectedPath || this._currentPath;
        console.log('vSSH SFTP: Uploading to', targetPath);

        try {
            for (const uri of uris) {
                const fileName = path.basename(uri.fsPath);
                const destPath = path.posix.join(targetPath, fileName);
                console.log('vSSH SFTP: Uploading', uri.fsPath, '->', destPath);
                
                await this._sftp.put(fs.createReadStream(uri.fsPath), destPath);
            }
            
            this._cache.delete(targetPath); // Очищаем кэш
            this.refresh();
            vscode.window.showInformationMessage(`Файлы загружены в ${targetPath}`);
        } catch (error: any) {
            console.error('vSSH SFTP: Upload error', error);
            vscode.window.showErrorMessage(`Ошибка загрузки: ${error.message}`);
        }
    }

    async navigateUp(): Promise<void> {
        if (this._currentPath === '/') return;
        const parent = path.posix.dirname(this._currentPath);
        this._currentPath = parent === '.' ? '/' : parent;
        this._cache.clear();
        this.refresh();
    }

    async changeDirectory(newPath: string): Promise<void> {
        try {
            // Проверяем существование директории
            await this._sftp!.stat(newPath);
            this._currentPath = newPath;
            this._cache.clear();
            this.refresh();
            vscode.window.showInformationMessage(`Переход в ${newPath}`);
        } catch (error: any) {
            vscode.window.showErrorMessage(`Директория не найдена: ${error.message}`);
        }
    }

    // Drag-and-drop
    handleDrag(source: SftpFileItem[], dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): void {
        // Не поддерживаем drag из SFTP
    }

    async handleDrop(target: SftpFileItem | undefined, dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
        console.log('vSSH SFTP: Drop event triggered');
        
        // Получаем URI файлов
        const uriListData = dataTransfer.get('text/uri-list');
        if (!uriListData) {
            console.log('vSSH SFTP: No uri-list data in drop');
            vscode.window.showWarningMessage('Перетащите файлы из VS Code Explorer или Finder');
            return;
        }

        try {
            const files = await uriListData.asString();
            console.log('vSSH SFTP: Got uri-list:', files);
            
            const uris = files.split('\n')
                .filter(line => line.trim())
                .map(line => vscode.Uri.parse(line.trim()));
            
            if (uris.length > 0) {
                console.log('vSSH SFTP: Uploading', uris.length, 'files');
                await this.uploadFiles(uris);
            } else {
                console.log('vSSH SFTP: No files found in drop');
                vscode.window.showWarningMessage('Перетащите файлы в SFTP панель');
            }
        } catch (error: any) {
            console.error('vSSH SFTP: Drop error', error);
            vscode.window.showErrorMessage(`Ошибка загрузки файлов: ${error.message}`);
        }
    }

    getCurrentPath(): string {
        return this._currentPath;
    }

    private async showPathSelectionMenu(): Promise<string | undefined> {
        // Получаем список доступных директорий
        const commonPaths = [
            { label: '/', description: 'Корневая директория' },
            { label: '/tmp', description: 'Временная директория' },
            { label: '/var', description: 'Вар директория' },
            { label: '/opt', description: 'Опт директория' },
        ];

        // Пытаемся получить список директорий первого уровня
        try {
            const list = await this._sftp!.list('/');
            const dirs = list.filter(item => item.type === 'd').map(item => ({
                label: `/${item.name}`,
                description: 'Директория'
            }));
            commonPaths.push(...dirs);
        } catch {
            // Игнорируем ошибку
        }

        const selected = await vscode.window.showQuickPick(commonPaths, {
            placeHolder: 'Выберите директорию для подключения'
        });

        return selected?.label;
    }
}
