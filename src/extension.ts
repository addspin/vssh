import * as vscode from 'vscode';
import { SSHConfigManager } from './sshConfig';
import { ServerProvider, ServerItem, FolderItem, VsshTreeItem } from './serverProvider';
import { SSHConnection } from './sshConnection';
import { SftpPanel } from './sftpPanel';
import { TunnelManager } from './tunnelManager';
import { SftpProvider, SftpFileItem } from './sftpProvider';
import { TunnelProvider, TunnelItem } from './tunnelProvider';
import { FavoriteManager } from './favoriteManager';
import { FavoriteProvider, FavoriteItem } from './favoriteProvider';
import { SessionManager } from './sessionManager';
import { SessionProvider, SessionGroupItem, SessionServerItem } from './sessionProvider';

let serverProvider: ServerProvider;
let sshConfigManager: SSHConfigManager;
let tunnelManager: TunnelManager;
let sftpProvider: SftpProvider;
let vsshTreeView: vscode.TreeView<VsshTreeItem> | undefined;
let tunnelProvider: TunnelProvider | undefined;
let favoriteManager: FavoriteManager | undefined;
let favoriteProvider: FavoriteProvider | undefined;
let sessionManager: SessionManager | undefined;
let sessionProvider: SessionProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('vSSH extension is now active!');

    // Инициализация менеджеров
    sshConfigManager = new SSHConfigManager();
    tunnelManager = new TunnelManager(sshConfigManager);
    favoriteManager = new FavoriteManager(sshConfigManager);
    sessionManager = new SessionManager(sshConfigManager);
    sftpProvider = new SftpProvider();

    // Провайдер дерева серверов
    serverProvider = new ServerProvider(sshConfigManager);

    // Провайдер дерева туннелей
    tunnelProvider = new TunnelProvider(tunnelManager);

    // Провайдер дерева избранного
    favoriteProvider = new FavoriteProvider(favoriteManager);

    // Провайдер дерева сессий
    sessionProvider = new SessionProvider(sessionManager, sshConfigManager);

    // Регистрация дерева через createTreeView (требуется для drag-and-drop)
    vsshTreeView = vscode.window.createTreeView('vsshExplorer', {
        treeDataProvider: serverProvider,
        dragAndDropController: serverProvider,
        showCollapseAll: true,
        canSelectMany: false
    });
    context.subscriptions.push(vsshTreeView);
    
    // Регистрация дерева туннелей
    context.subscriptions.push(
        vscode.window.createTreeView('vsshTunnels', {
            treeDataProvider: tunnelProvider,
            showCollapseAll: false
        })
    );
    
    // Регистрация дерева избранного
    context.subscriptions.push(
        vscode.window.createTreeView('vsshFavorites', {
            treeDataProvider: favoriteProvider,
            showCollapseAll: false
        })
    );
    
    // Регистрация дерева сессий
    context.subscriptions.push(
        vscode.window.createTreeView('vsshSessions', {
            treeDataProvider: sessionProvider,
            showCollapseAll: false
        })
    );
    
    // Регистрация SFTP дерева
    context.subscriptions.push(
        vscode.window.createTreeView('vsshSftp', {
            treeDataProvider: sftpProvider,
            showCollapseAll: false,
            canSelectMany: false
        })
    );

    // Автозапуск туннелей
    tunnelManager.startAllAutoTunnels();

    // Команда: Поиск серверов
    context.subscriptions.push(
        vscode.commands.registerCommand('vssh.searchServers', async () => {
            const servers = sshConfigManager.getServers();
            if (servers.length === 0) {
                vscode.window.showInformationMessage('Нет серверов для поиска');
                return;
            }

            const searchQuery = await vscode.window.showInputBox({
                prompt: 'Поиск серверов',
                placeHolder: 'Введите имя, хост или пользователя'
            });

            if (!searchQuery) {
                return;
            }

            const query = searchQuery.toLowerCase();
            const filteredServers = servers.filter(server => 
                server.name.toLowerCase().includes(query) ||
                server.host.toLowerCase().includes(query) ||
                server.username.toLowerCase().includes(query)
            );

            if (filteredServers.length === 0) {
                vscode.window.showInformationMessage(`Серверы не найдены по запросу "${searchQuery}"`);
                return;
            }

            const quickPickItems = filteredServers.map(server => ({
                label: server.name,
                description: `${server.host}:${server.port}`,
                detail: server.folder ? `Папка: ${server.folder}` : 'Корень',
                server: server
            }));

            const selected = await vscode.window.showQuickPick(quickPickItems, {
                placeHolder: `Найдено серверов: ${filteredServers.length}`,
                matchOnDescription: true,
                matchOnDetail: true
            });

            if (selected) {
                // Раскрываем дерево и находим сервер
                const serverItem = new ServerItem(selected.server);
                vscode.commands.executeCommand('vssh.connect', serverItem);
            }
        })
    );

    // Команда: Добавить папку
    context.subscriptions.push(
        vscode.commands.registerCommand('vssh.addFolder', async (folderItem?: FolderItem) => {
            const name = await vscode.window.showInputBox({
                prompt: 'Введите имя папки',
                placeHolder: 'Например: Production, Development'
            });
            if (!name) return;

            // Выбор цвета папки
            const colorOptions = [
                { label: '🔵 Синий', color: '#4a90d9' },
                { label: '🟢 Зелёный', color: '#50a14f' },
                { label: '🟡 Жёлтый', color: '#c1a043' },
                { label: '🟠 Оранжевый', color: '#d48c21' },
                { label: '🔴 Красный', color: '#e05555' },
                { label: '🟣 Фиолетовый', color: '#a655d9' },
                { label: '⚪ Серый', color: '#858585' },
                { label: '⚫ Без цвета', color: undefined }
            ];

            const selectedColor = await vscode.window.showQuickPick(colorOptions, {
                placeHolder: 'Выберите цвет папки (необязательно)'
            });

            // Определяем родительскую папку из текущего выделения
            let parentFolder: string | undefined;
            
            if (vsshTreeView && vsshTreeView.selection.length > 0) {
                const selectedItem = vsshTreeView.selection[0];
                if (selectedItem instanceof FolderItem) {
                    parentFolder = selectedItem.folderId;
                }
            }

            serverProvider.addFolder(name, parentFolder, selectedColor?.color);
            serverProvider.refresh();
        })
    );

    // Команда: Добавить сервер
    context.subscriptions.push(
        vscode.commands.registerCommand('vssh.addServer', async (folderItem?: FolderItem) => {
            const folderId = folderItem ? folderItem.folderId : undefined;
            const serverDetails = await showServerInputForm(folderId);
            if (serverDetails) {
                await sshConfigManager.addServer(serverDetails);
                serverProvider.refresh();
                vscode.window.showInformationMessage(`Сервер "${serverDetails.name}" добавлен`);
            }
        })
    );

    // Команда: Подключиться
    context.subscriptions.push(
        vscode.commands.registerCommand('vssh.connect', async (item: ServerItem) => {
            if (!item.server) {
                return;
            }
            const connection = new SSHConnection(item.server);
            await connection.connect();
        })
    );

    // Команда: Редактировать сервер
    context.subscriptions.push(
        vscode.commands.registerCommand('vssh.editServer', async (item: ServerItem) => {
            if (!item.server) {
                return;
            }
            const serverDetails = await showServerInputForm(item.server.folder, item.server);
            if (serverDetails) {
                await sshConfigManager.updateServer(item.server.name, serverDetails);
                serverProvider.refresh();
                vscode.window.showInformationMessage(`Сервер "${serverDetails.name}" обновлен`);
            }
        })
    );

    // Команда: Удалить сервер
    context.subscriptions.push(
        vscode.commands.registerCommand('vssh.deleteServer', async (item: ServerItem) => {
            if (!item.server) {
                return;
            }
            const confirm = await vscode.window.showWarningMessage(
                `Удалить сервер "${item.server.name}"?`,
                { modal: true },
                'Удалить'
            );
            if (confirm) {
                await sshConfigManager.deleteServer(item.server.name);
                serverProvider.refresh();
            }
        })
    );

    // Команда: Редактировать папку
    context.subscriptions.push(
        vscode.commands.registerCommand('vssh.editFolder', async (item: FolderItem) => {
            const folder = sshConfigManager.getFolder(item.folderId);
            
            // Сначала показываем изменение имени
            const newName = await vscode.window.showInputBox({
                prompt: 'Новое имя папки',
                value: item.folderName,
                placeHolder: 'Имя папки'
            });
            
            // Затем показываем выбор цвета
            const colorOptions = [
                { label: '🔵 Синий', color: '#4a90d9', picked: folder?.color === '#4a90d9' },
                { label: '🟢 Зелёный', color: '#50a14f', picked: folder?.color === '#50a14f' },
                { label: '🟡 Жёлтый', color: '#c1a043', picked: folder?.color === '#c1a043' },
                { label: '🟠 Оранжевый', color: '#d48c21', picked: folder?.color === '#d48c21' },
                { label: '🔴 Красный', color: '#e05555', picked: folder?.color === '#e05555' },
                { label: '🟣 Фиолетовый', color: '#a655d9', picked: folder?.color === '#a655d9' },
                { label: '⚫ Без цвета', color: undefined, picked: !folder?.color }
            ];
            
            const selectedColor = await vscode.window.showQuickPick(colorOptions, {
                placeHolder: 'Выберите цвет папки'
            });
            
            // Применяем выбранный цвет (всегда, даже если не менялось имя)
            const finalColor = selectedColor?.color;
            
            if (newName && newName !== item.folderName) {
                // Изменение имени (и цвета)
                sshConfigManager.renameFolder(item.folderId, newName);
                if (finalColor !== undefined && folder) {
                    folder.color = finalColor;
                    sshConfigManager.updateFolder(folder);
                }
            } else if (finalColor !== undefined) {
                // Только изменение цвета
                if (folder) {
                    folder.color = finalColor;
                    sshConfigManager.updateFolder(folder);
                }
            }
            
            serverProvider.refresh();
        })
    );

    // Команда: Удалить папку
    context.subscriptions.push(
        vscode.commands.registerCommand('vssh.deleteFolder', async (item: FolderItem) => {
            const childFolders = serverProvider.getFolders().filter(f => f.parentFolder === item.folderId);

            let message = `Удалить папку "${item.folderName}"?`;

            if (childFolders.length > 0) {
                message += `\n\n⚠️ ${childFolders.length} подпапок будет удалено.`;
            }

            message += `\n\n⚠️ ВСЕ серверы в этой папке и подпапках будут УДАЛЕНЫ!`;
            message += `\n\nЭто действие необратимо и может привести к потере данных.`;

            const confirm = await vscode.window.showWarningMessage(
                message,
                { modal: true },
                'Удалить'
            );
            if (confirm) {
                serverProvider.deleteFolder(item.folderId);
                serverProvider.refresh();
            }
        })
    );

    // Команда: Переместить сервер
    context.subscriptions.push(
        vscode.commands.registerCommand('vssh.moveServer', async (item: ServerItem) => {
            if (!item.server) {
                return;
            }
            const folders = serverProvider.getFolders().filter(f => f.name !== item.server.folder);
            if (folders.length === 0) {
                vscode.window.showInformationMessage('Нет других папок для перемещения');
                return;
            }
            const quickPickItems: vscode.QuickPickItem[] = [
                ...folders.map(f => ({ label: f.name, description: f.parentFolder ? `Подпапка в ${f.parentFolder}` : 'Папка' }))
            ];

            const selected = await vscode.window.showQuickPick(quickPickItems, {
                placeHolder: 'Выберите папку'
            });

            if (selected) {
                await sshConfigManager.moveServer(item.server.name, selected.label);
                serverProvider.refresh();
            }
        })
    );

    // Команда: Переместить сервер в корень
    context.subscriptions.push(
        vscode.commands.registerCommand('vssh.moveServerUp', async (item: ServerItem) => {
            if (!item.server) {
                return;
            }
            await sshConfigManager.moveServer(item.server.name, undefined);
            serverProvider.refresh();
        })
    );

    // Команда: Переместить папку
    context.subscriptions.push(
        vscode.commands.registerCommand('vssh.moveFolder', async (item: FolderItem) => {
            const folders = serverProvider.getFolders().filter(f => f.name !== item.folderName && f.name !== item.parentFolder);
            if (folders.length === 0) {
                vscode.window.showInformationMessage('Нет других папок для перемещения');
                return;
            }
            const quickPickItems: vscode.QuickPickItem[] = [
                { label: '', description: 'Корневой уровень' },
                ...folders.map(f => ({ label: f.name, description: f.parentFolder ? `Подпапка в ${f.parentFolder}` : 'Папка' }))
            ];

            const selected = await vscode.window.showQuickPick(quickPickItems, {
                placeHolder: 'Выберите целевую папку'
            });

            if (selected) {
                const targetFolder = selected.label || undefined;
                await sshConfigManager.moveFolder(item.folderName, targetFolder);
                serverProvider.refresh();
            }
        })
    );

    // Команда: Переместить папку в корень
    context.subscriptions.push(
        vscode.commands.registerCommand('vssh.moveFolderUp', async (item: FolderItem) => {
            await sshConfigManager.moveFolder(item.folderName, undefined);
            serverProvider.refresh();
        })
    );

    // Команда: Открыть SSH config
    context.subscriptions.push(
        vscode.commands.registerCommand('vssh.openConfig', async () => {
            await sshConfigManager.openConfigFile();
        })
    );

    // Команда: Импорт SSH config (legacy)
    context.subscriptions.push(
        vscode.commands.registerCommand('vssh.importConfig', async () => {
            const uris = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                filters: { 'SSH Config': ['config', 'txt'] }
            });
            if (uris && uris.length > 0) {
                await sshConfigManager.importConfig(uris[0].fsPath);
                serverProvider.refresh();
                vscode.window.showInformationMessage('Конфигурация импортирована (legacy формат)');
            }
        })
    );

    // Команда: Импорт vSSH config (JSON)
    context.subscriptions.push(
        vscode.commands.registerCommand('vssh.importVsshConfig', async () => {
            const uris = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                filters: { 'JSON': ['json'] }
            });
            if (uris && uris.length > 0) {
                await sshConfigManager.importConfig(uris[0].fsPath);
                serverProvider.refresh();
                vscode.window.showInformationMessage('Конфигурация vSSH импортирована');
            }
        })
    );

    // Команда: Экспорт SSH config (legacy)
    context.subscriptions.push(
        vscode.commands.registerCommand('vssh.exportConfig', async () => {
            const uri = await vscode.window.showSaveDialog({
                filters: { 'SSH Config': ['config', 'txt'] }
            });
            if (uri) {
                await sshConfigManager.exportConfig(uri.fsPath);
            }
        })
    );

    // Команда: Экспорт vSSH config (без паролей)
    context.subscriptions.push(
        vscode.commands.registerCommand('vssh.exportVsshConfig', async () => {
            const uri = await vscode.window.showSaveDialog({
                filters: { 'JSON': ['json'] }
            });
            if (uri) {
                await sshConfigManager.exportVsshConfig(uri.fsPath, false);
            }
        })
    );

    // Команда: Экспорт vSSH config с паролями
    context.subscriptions.push(
        vscode.commands.registerCommand('vssh.exportVsshConfigWithPasswords', async () => {
            const confirm = await vscode.window.showWarningMessage(
                'Экспорт с паролями в открытом виде! Файл будет небезопасен. Продолжить?',
                { modal: true },
                'Экспортировать'
            );
            if (!confirm) return;
            
            const uri = await vscode.window.showSaveDialog({
                filters: { 'JSON': ['json'] }
            });
            if (uri) {
                await sshConfigManager.exportVsshConfig(uri.fsPath, true);
            }
        })
    );

    // Команда: Открыть SFTP панель
    context.subscriptions.push(
        vscode.commands.registerCommand('vssh.openSftp', async (item: ServerItem) => {
            if (!item.server) {
                return;
            }
            await sftpProvider.connect(item.server);
            // Раскрываем SFTP view
            vscode.commands.executeCommand('vsshSftp.focus');
        })
    );

    // Команда: SFTP Download
    context.subscriptions.push(
        vscode.commands.registerCommand('vssh.sftpDownload', async (item: SftpFileItem) => {
            if (!item) return;
            if (item.fileType === 'folder') {
                await sftpProvider.downloadFolder(item.filePath);
            } else {
                await sftpProvider.downloadFile(item.filePath);
            }
        })
    );

    // Команда: SFTP Open File
    context.subscriptions.push(
        vscode.commands.registerCommand('vssh.sftpOpenFile', async (item: SftpFileItem) => {
            if (!item || item.fileType === 'folder') return;
            await sftpProvider.openFile(item.filePath);
        })
    );

    // Команда: SFTP Upload
    context.subscriptions.push(
        vscode.commands.registerCommand('vssh.sftpUpload', async () => {
            const uris = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: true
            });
            if (uris) {
                await sftpProvider.uploadFiles(uris);
            }
        })
    );

    // Команда: SFTP Delete
    context.subscriptions.push(
        vscode.commands.registerCommand('vssh.sftpDelete', async (item: SftpFileItem) => {
            if (!item) return;
            await sftpProvider.deleteFile(item.filePath);
        })
    );

    // Команда: SFTP Refresh
    context.subscriptions.push(
        vscode.commands.registerCommand('vssh.sftpRefresh', async () => {
            sftpProvider.refresh();
        })
    );

    // Команда: SFTP Disconnect
    context.subscriptions.push(
        vscode.commands.registerCommand('vssh.sftpDisconnect', async () => {
            sftpProvider.disconnect();
        })
    );

    // Команда: SFTP Navigate Up
    context.subscriptions.push(
        vscode.commands.registerCommand('vssh.sftpNavigateUp', async () => {
            await sftpProvider.navigateUp();
        })
    );

    // Команда: SFTP Change Directory
    context.subscriptions.push(
        vscode.commands.registerCommand('vssh.sftpChangeDirectory', async () => {
            const path = await vscode.window.showInputBox({
                prompt: 'Введите путь к директории',
                value: sftpProvider.getCurrentPath(),
                placeHolder: '/path/to/directory'
            });
            if (path) {
                sftpProvider.changeDirectory(path);
            }
        })
    );

    // Команда: SFTP Select Item
    context.subscriptions.push(
        vscode.commands.registerCommand('vssh.sftpSelectItem', async (item: SftpFileItem) => {
            if (!item) return;
            sftpProvider.setSelectedPath(item.filePath);
            vscode.window.showInformationMessage(`Выбрана папка: ${item.filePath}`);
        })
    );

    // Команда: SFTP Create Folder
    context.subscriptions.push(
        vscode.commands.registerCommand('vssh.sftpCreateFolder', async () => {
            const folderName = await vscode.window.showInputBox({
                prompt: 'Имя папки',
                placeHolder: 'Новая папка'
            });
            if (folderName) {
                await sftpProvider.createFolder(folderName);
            }
        })
    );

    // Команда: Создать туннель
    context.subscriptions.push(
        vscode.commands.registerCommand('vssh.createTunnel', async (item: ServerItem) => {
            if (!item.server) {
                return;
            }
            const tunnelConfig = await vscode.window.showInputBox({
                prompt: 'Введите параметры туннеля (localPort:remoteHost:remotePort)',
                placeHolder: 'Например: 8080:localhost:80',
                value: '8080:localhost:80'
            });

            if (tunnelConfig) {
                const [localPort, remoteHost, remotePort] = tunnelConfig.split(':');
                
                // Спрашиваем про автозапуск
                const autoStart = await vscode.window.showQuickPick(
                    [
                        { label: 'Да', value: true, description: 'Автозапуск при старте VS Code' },
                        { label: 'Нет', value: false, description: 'Только для текущей сессии' }
                    ],
                    { placeHolder: 'Запускать туннель автоматически при старте VS Code?' }
                );
                
                await tunnelManager.createTunnel(
                    item.server,
                    parseInt(localPort),
                    remoteHost,
                    parseInt(remotePort),
                    autoStart?.value || false
                );
            }
        })
    );

    // Команда: Запустить туннель
    context.subscriptions.push(
        vscode.commands.registerCommand('vssh.startTunnel', async (item: TunnelItem) => {
            if (!item) {
                // Если вызвано из меню, выбираем из списка
                const tunnels = tunnelManager.getSavedTunnels().filter(t => !t.isActive);
                if (tunnels.length === 0) {
                    vscode.window.showInformationMessage('Нет неактивных туннелей');
                    return;
                }
                const quickPickItems = tunnels.map(t => ({
                    label: `${t.serverName}:${t.localPort} -> ${t.remoteHost}:${t.remotePort}`,
                    tunnel: t
                }));
                const selected = await vscode.window.showQuickPick(quickPickItems, {
                    placeHolder: 'Выберите туннель для запуска'
                });
                if (selected) {
                    await tunnelManager.startTunnel(selected.tunnel.localPort);
                }
                return;
            }
            await tunnelManager.startTunnel(item.tunnel.localPort);
        })
    );

    // Команда: Остановить туннель
    context.subscriptions.push(
        vscode.commands.registerCommand('vssh.stopTunnel', async (item: TunnelItem) => {
            if (!item) {
                const tunnels = tunnelManager.getActiveTunnels();
                if (tunnels.length === 0) {
                    vscode.window.showInformationMessage('Нет активных туннелей');
                    return;
                }
                const quickPickItems = tunnels.map(t => ({
                    label: `${t.serverName}:${t.localPort} -> ${t.remoteHost}:${t.remotePort}`,
                    localPort: t.localPort
                }));
                const selected = await vscode.window.showQuickPick(quickPickItems, {
                    placeHolder: 'Выберите туннель для остановки'
                });
                if (selected) {
                    await tunnelManager.closeTunnel(selected.localPort);
                }
                return;
            }
            await tunnelManager.closeTunnel(item.tunnel.localPort);
        })
    );

    // Команда: Удалить туннель
    context.subscriptions.push(
        vscode.commands.registerCommand('vssh.deleteTunnel', async (item: TunnelItem) => {
            const tunnel = item?.tunnel;
            if (!tunnel) {
                return;
            }
            
            const confirm = await vscode.window.showWarningMessage(
                `Удалить туннель "${tunnel.serverName}:${tunnel.localPort}"?`,
                { modal: true },
                'Удалить'
            );
            
            if (confirm) {
                await tunnelManager.deleteTunnel(tunnel.localPort);
            }
        })
    );

    // Команда: Закрыть все туннели
    context.subscriptions.push(
        vscode.commands.registerCommand('vssh.closeAllTunnels', async () => {
            const tunnels = tunnelManager.getActiveTunnels();
            if (tunnels.length === 0) {
                vscode.window.showInformationMessage('Нет активных туннелей');
                return;
            }
            
            const confirm = await vscode.window.showWarningMessage(
                `Закрыть все ${tunnels.length} туннелей?`,
                { modal: true },
                'Закрыть все'
            );
            
            if (confirm) {
                for (const tunnel of tunnels) {
                    await tunnelManager.closeTunnel(tunnel.localPort);
                }
                vscode.window.showInformationMessage('Все туннели закрыты');
            }
        })
    );

    // Команда: Добавить в избранное
    context.subscriptions.push(
        vscode.commands.registerCommand('vssh.addFavorite', async (item: ServerItem) => {
            if (!item.server || !favoriteManager) {
                return;
            }
            await favoriteManager.addFavorite(item.server);
        })
    );

    // Команда: Открыть избранное
    context.subscriptions.push(
        vscode.commands.registerCommand('vssh.openFavorite', async (item: FavoriteItem) => {
            if (!item || !favoriteManager) {
                return;
            }
            await favoriteManager.connectToFavorite(item.favorite);
        })
    );

    // Команда: Удалить из избранного
    context.subscriptions.push(
        vscode.commands.registerCommand('vssh.removeFavorite', async (item: FavoriteItem) => {
            if (!item || !favoriteManager) {
                return;
            }
            await favoriteManager.removeFavorite(item.favorite.id);
        })
    );

    // Команда: Очистить все избранное
    context.subscriptions.push(
        vscode.commands.registerCommand('vssh.clearAllFavorites', async () => {
            if (!favoriteManager) {
                return;
            }
            
            const favorites = favoriteManager.getFavorites();
            if (favorites.length === 0) {
                vscode.window.showInformationMessage('Нет избранных серверов');
                return;
            }
            
            const confirm = await vscode.window.showWarningMessage(
                `Удалить все ${favorites.length} избранных серверов?`,
                { modal: true },
                'Удалить все'
            );
            
            if (confirm) {
                await favoriteManager.clearAllFavorites();
            }
        })
    );

    // Команда: Создать сессию
    context.subscriptions.push(
        vscode.commands.registerCommand('vssh.createSession', async (item?: ServerItem) => {
            if (!sessionManager) {
                return;
            }
            
            const sessionName = await vscode.window.showInputBox({
                prompt: 'Имя сессии',
                placeHolder: 'Например: Production Servers, Daily Deploy'
            });
            
            if (sessionName) {
                const session = await sessionManager.createSession(sessionName);
                
                // Если вызвано из контекста сервера - добавляем сервер в сессию
                if (item && item.server) {
                    await sessionManager.addServerToSession(session.id, item.server.name);
                }
            }
        })
    );

    // Команда: Сохранить сервер в сессию
    context.subscriptions.push(
        vscode.commands.registerCommand('vssh.saveToSession', async (item: ServerItem) => {
            if (!item.server || !sessionManager) {
                return;
            }
            
            const sessions = sessionManager.getSessions();
            if (sessions.length === 0) {
                const createNew = await vscode.window.showWarningMessage(
                    'Нет сохранённых сессий. Создать новую?',
                    'Создать сессию'
                );
                if (createNew) {
                    const sessionName = await vscode.window.showInputBox({
                        prompt: 'Имя сессии',
                        placeHolder: 'Например: Production Servers'
                    });
                    if (sessionName) {
                        const session = await sessionManager.createSession(sessionName);
                        await sessionManager.addServerToSession(session.id, item.server.name);
                    }
                }
                return;
            }
            
            const quickPickItems = sessions.map(session => ({
                label: session.name,
                description: `${session.servers.length} серверов`,
                sessionId: session.id
            }));
            
            const selected = await vscode.window.showQuickPick(quickPickItems, {
                placeHolder: 'Выберите сессию для сохранения'
            });
            
            if (selected) {
                await sessionManager.addServerToSession(selected.sessionId, item.server.name);
            }
        })
    );

    // Команда: Запустить сессию
    context.subscriptions.push(
        vscode.commands.registerCommand('vssh.launchSession', async (item: SessionGroupItem) => {
            if (!item || !sessionManager) {
                return;
            }
            await sessionManager.connectToSession(item.session);
        })
    );

    // Команда: Удалить сервер из сессии
    context.subscriptions.push(
        vscode.commands.registerCommand('vssh.removeServerFromSession', async (item: SessionServerItem) => {
            if (!item || !sessionManager) {
                return;
            }
            await sessionManager.removeServerFromSession(item.sessionId, item.serverName);
        })
    );

    // Команда: Удалить сессию
    context.subscriptions.push(
        vscode.commands.registerCommand('vssh.deleteSession', async (item: SessionGroupItem) => {
            if (!item || !sessionManager) {
                return;
            }
            
            const confirm = await vscode.window.showWarningMessage(
                `Удалить сессию "${item.session.name}"?`,
                { modal: true },
                'Удалить'
            );
            
            if (confirm) {
                await sessionManager.deleteSession(item.session.id);
            }
        })
    );
}

async function showServerInputForm(
    folderId?: string,
    existingServer?: { name: string; host: string; port: number; username: string; authMethod: string; folder?: string; privateKeyPath?: string; password?: string; gateway?: { host: string; port: number; username: string; authMethod: string; password?: string; privateKeyPath?: string } }
): Promise<{
    name: string;
    host: string;
    port: number;
    username: string;
    authMethod: 'password' | 'privateKey';
    folder?: string;
    privateKeyPath?: string;
    password?: string;
    gateway?: { host: string; port: number; username: string; authMethod: 'password' | 'privateKey'; password?: string; privateKeyPath?: string }
} | undefined> {
    const name = await vscode.window.showInputBox({
        prompt: 'Имя сервера',
        value: existingServer?.name,
        placeHolder: 'Например: my-server'
    });
    if (!name) return undefined;

    const host = await vscode.window.showInputBox({
        prompt: 'Host (IP или домен)',
        value: existingServer?.host,
        placeHolder: 'Например: 192.168.1.1 или example.com'
    });
    if (!host) return undefined;

    const portStr = await vscode.window.showInputBox({
        prompt: 'Порт',
        value: existingServer?.port?.toString() || '22',
        placeHolder: '22'
    });
    const port = parseInt(portStr || '22');

    const username = await vscode.window.showInputBox({
        prompt: 'Имя пользователя',
        value: existingServer?.username,
        placeHolder: 'Например: root'
    });
    if (!username) return undefined;

    const authOptions = [
        { label: 'privateKey', description: 'Приватный ключ' },
        { label: 'password', description: 'Пароль' }
    ];
    const defaultAuthOption = existingServer?.authMethod === 'password' ? 1 : 0;

    const authMethodIndex = await vscode.window.showQuickPick(
        authOptions.map((opt, idx) => ({ label: opt.label, description: opt.description, picked: idx === defaultAuthOption })),
        {
            placeHolder: 'Метод аутентификации'
        }
    ).then(selected => selected ? authOptions.findIndex(o => o.label === selected.label) : -1);

    if (authMethodIndex === -1) return undefined;
    const authMethod = authOptions[authMethodIndex].label as 'password' | 'privateKey';

    let privateKeyPath: string | undefined;
    let password: string | undefined;

    if (authMethod === 'privateKey') {
        const uris = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: { 'All Files': ['*'] }
        });
        if (uris && uris.length > 0) {
            privateKeyPath = uris[0].fsPath;
        } else if (existingServer?.privateKeyPath) {
            privateKeyPath = existingServer.privateKeyPath;
        } else {
            return undefined;
        }
    } else if (authMethod === 'password') {
        // Запрашиваем пароль при выборе аутентификации по паролю
        password = await vscode.window.showInputBox({
            prompt: 'Пароль',
            password: true,
            placeHolder: 'Введите пароль'
        });
        if (!password && !existingServer?.password) {
            vscode.window.showWarningMessage('Пароль не введён, но сервер будет создан. Вы сможете добавить пароль позже.');
        }
        password = password || existingServer?.password;
    }

    // Настройка SSH Gateway (Jump Host)
    const gatewayItems = [
        { label: 'Настроить Gateway', description: 'Требуется для доступа через bastion/hop', value: 'setup' },
        { label: 'Без Gateway', description: 'Прямое подключение', value: 'none' }
    ];
    
    const gatewayChoice = await vscode.window.showQuickPick(gatewayItems, {
        placeHolder: 'Требуется ли подключение через Gateway (Jump Host)?'
    });

    let gateway: any = undefined;
    
    if (gatewayChoice?.value === 'setup') {
        const gatewayHost = await vscode.window.showInputBox({
            prompt: 'Gateway Host (IP или домен)',
            value: existingServer?.gateway?.host,
            placeHolder: 'Например: 10.0.0.1 или bastion.example.com'
        });
        
        if (gatewayHost) {
            const gatewayPortStr = await vscode.window.showInputBox({
                prompt: 'Gateway Порт',
                value: existingServer?.gateway?.port?.toString() || '22',
                placeHolder: '22'
            });
            const gatewayPort = parseInt(gatewayPortStr || '22');

            const gatewayUsername = await vscode.window.showInputBox({
                prompt: 'Gateway Имя пользователя',
                value: existingServer?.gateway?.username,
                placeHolder: 'Например: jumpuser'
            });

            const gatewayAuthOptions = [
                { label: 'privateKey', description: 'Приватный ключ' },
                { label: 'password', description: 'Пароль' }
            ];
            const defaultGatewayAuthOption = existingServer?.gateway?.authMethod === 'password' ? 1 : 0;

            const gatewayAuthMethodIndex = await vscode.window.showQuickPick(
                gatewayAuthOptions.map((opt, idx) => ({ label: opt.label, description: opt.description, picked: idx === defaultGatewayAuthOption })),
                {
                    placeHolder: 'Метод аутентификации Gateway'
                }
            ).then(selected => selected ? gatewayAuthOptions.findIndex(o => o.label === selected.label) : -1);

            if (gatewayAuthMethodIndex !== -1) {
                const gatewayAuthMethod = gatewayAuthOptions[gatewayAuthMethodIndex].label as 'password' | 'privateKey';
                
                let gatewayPrivateKeyPath: string | undefined;
                let gatewayPassword: string | undefined;

                if (gatewayAuthMethod === 'privateKey') {
                    const uris = await vscode.window.showOpenDialog({
                        canSelectFiles: true,
                        canSelectFolders: false,
                        canSelectMany: false,
                        filters: { 'All Files': ['*'] }
                    });
                    if (uris && uris.length > 0) {
                        gatewayPrivateKeyPath = uris[0].fsPath;
                    } else if (existingServer?.gateway?.privateKeyPath) {
                        gatewayPrivateKeyPath = existingServer.gateway.privateKeyPath;
                    }
                } else if (gatewayAuthMethod === 'password') {
                    gatewayPassword = await vscode.window.showInputBox({
                        prompt: 'Gateway Пароль',
                        password: true,
                        placeHolder: 'Введите пароль для Gateway'
                    });
                    gatewayPassword = gatewayPassword || existingServer?.gateway?.password;
                }

                gateway = {
                    host: gatewayHost,
                    port: gatewayPort,
                    username: gatewayUsername || '',
                    authMethod: gatewayAuthMethod,
                    password: gatewayPassword,
                    privateKeyPath: gatewayPrivateKeyPath
                };
            }
        }
    }

    return {
        name,
        host,
        port,
        username,
        authMethod,
        folder: folderId || existingServer?.folder,
        privateKeyPath,
        password,
        gateway
    };
}

export function deactivate() {
    tunnelManager.dispose();
    favoriteManager?.dispose();
    sessionManager?.dispose();
}
