# vSSH - SSH Manager for VS Code and Cursor

Менеджер SSH подключений с интеграцией SFTP, поддержкой туннелей и SSH Gateway.

## Возможности

- 📁 **Организация серверов** - группировка по папкам с цветовой маркировкой
- 🔌 **Быстрое подключение** - SSH терминал в один клик
- 📤 **SFTP браузер** - передача файлов
- 🚇 **SSH туннели** - создание локальных туннелей с автозапуском
- 🌉 **SSH Gateway** - подключение через Bastion/Jump Host
- 🔍 **Поиск серверов** - быстрый поиск по имени, хосту, пользователю
- 📋 **Отдельный конфиг** - `~/.vssh/vssh-config.json`
- 🔐 **Шифрование** - AES-256-CBC для паролей
- 📥 **Импорт/Экспорт** - перенос конфигурации

---

## Требования

### Для password аутентификации:
- **macOS:** `brew install sshpass`
- **Linux:** `apt install sshpass`
- **Windows:** Не требуется (используется встроенная аутентификация)

### Для privateKey аутентификации:
- Ничего дополнительно не требуется

### Для SSH Gateway с паролем:
- Требуется `sshpass` (см. выше)

---

## Установка

### VS Code

```bash
# Из VSIX файла
code --install-extension vssh-0.1.0.vsix --force

# После установки перезапустите VS Code (Cmd+Q / полностью закройте и откройте)
```

### Cursor

```bash
# Из VSIX файла
cursor --install-extension vssh-0.1.0.vsix --force
```

### Из GitHub Releases

1. Скачайте `.vsix` файл со страницы [Releases](https://github.com/addspin/vssh/releases)
2. Установите командой выше или через GUI

---

## Запуск и использование

### После установки

1. Откройте VS Code или Cursor
2. Нажмите на иконку **vSSH Explorer** в левой панели (activity bar)
3. Или нажмите `Ctrl+Shift+P` (Cmd+Shift+P на Mac) → введите `vSSH`

### Первый запуск для разработки

Если вы разрабатываете плагин:

```bash
# Терминал 1: режим компиляции с наблюдением
npm run watch

# Терминал 2: запустите VS Code для отладки
code .
# Затем нажмите F5 для запуска в режиме отладки
```

Откроется новое окно VS Code с установленным плагином.

---

## Использование

### Открытие панели

1. Нажмите на иконку **vSSH Explorer** в activity bar (слева)
2. Или `Ctrl+Shift+P` → `vSSH: SSH Servers`

### Добавление сервера

1. Нажмите кнопку **+ Add Server** в панели
2. Заполните параметры:
   - Имя сервера
   - Host (IP или домен)
   - Порт (по умолчанию 22)
   - Имя пользователя
   - Метод аутентификации (ключ или пароль)
3. **Настройте Gateway** (опционально):
   - Выберите "Настроить Gateway"
   - Введите Gateway Host, Port, Username
   - Выберите метод аутентификации Gateway
4. Нажмите Enter

### Подключение

- Кликните на сервер → иконка **Connect** (📎)
- Откроется терминал с SSH сессией

### SFTP

1. Правый клик на сервере → **Open SFTP Panel**
2. Откроется панель с файлами сервера
3. Используйте кнопки для загрузки/скачивания файлов

### Туннели

#### Создание туннеля:
1. Правый клик на сервере → **Create Tunnel**
2. Введите: `localPort:remoteHost:remotePort` (например: `8080:localhost:80`)
3. Выберите **автозапуск** (опционально)

#### Управление туннелями:
- Панель **SSH Tunnels** отображает все сохранённые туннели
- 🚀 - туннели с автозапуском
- ▶️ - запустить туннель
- ⏹️ - остановить туннель
- 🗑️ - удалить туннель
- **Close All** - закрыть все активные туннели

#### Автозапуск туннелей:
- Туннели с 🚀 запускаются автоматически при старте VS Code
- Остальные можно запустить вручную из панели туннелей

### SSH Gateway (Bastion / Jump Host)

Подключение к внутренним серверам через промежуточный хост:

1. При создании сервера выберите **"Настроить Gateway"**
2. Заполните параметры Gateway:
   - **Host** - IP или домен bastion (например: `10.0.0.1`)
   - **Port** - порт bastion (обычно 22)
   - **Username** - пользователь на bastion
   - **Auth Method** - ключ или пароль
   - **Password/Key** - аутентификация для bastion

**Пример сценария:**
```
Ваш компьютер → Bastion (10.0.0.1) → Внутренний сервер (192.168.1.100)
```

### Папки

#### Создание папки:
- Нажмите **+ Add Folder** в заголовке панели
- Или правый клик на папке → **Add Folder** (создаст подпапку)

#### Цвет папки:
- При создании выберите цвет (синий, зелёный, жёлтый, оранжевый, красный, фиолетовый)
- Правый клик на папке → **Edit Folder** → изменить цвет

#### Перемещение:
- **Drag-and-drop** серверов и папок между папками
- Перетащите в корень для извлечения из папки

#### Удаление:
- Правый клик на папке → **Delete Folder**
- ⚠️ Удаляет все серверы и подпапки внутри

### Поиск серверов

1. Нажмите кнопку **🔍 Search Servers** в панели
2. Введите запрос (имя, хост или пользователь)
3. Выберите сервер из списка
4. Сервер подключится

---

## Команды

| Команда | Описание |
|---------|----------|
| `vSSH: Add Server` | Добавить сервер |
| `vSSH: Add Folder` | Создать папку |
| `vSSH: Search Servers` | Поиск серверов |
| `vSSH: Connect` | Подключиться по SSH |
| `vSSH: Edit Server` | Редактировать сервер |
| `vSSH: Delete Server` | Удалить сервер |
| `vSSH: Edit Folder` | Редактировать папку (имя, цвет) |
| `vSSH: Delete Folder` | Удалить папку |
| `vSSH: Open SFTP Panel` | Открыть SFTP браузер |
| `vSSH: Create Tunnel` | Создать туннель |
| `vSSH: Start Tunnel` | Запустить сохранённый туннель |
| `vSSH: Stop Tunnel` | Остановить туннель |
| `vSSH: Delete Tunnel` | Удалить туннель |
| `vSSH: Close All Tunnels` | Закрыть все туннели |
| `vSSH: Open SSH Config` | Открыть файл конфигурации |
| `vSSH: Import SSH Config` | Импортировать конфигурацию |
| `vSSH: Export SSH Config` | Экспортировать конфигурацию |

---

## Конфигурация

### Расположение

```
~/.vssh/vssh-config.json
```

### Формат

```json
{
  "servers": [
    {
      "name": "production",
      "host": "192.168.1.100",
      "port": 22,
      "username": "admin",
      "authMethod": "privateKey",
      "privateKeyPath": "/Users/user/.ssh/id_rsa",
      "folder": "a1b2c3d4e5f6",
      "gateway": {
        "host": "10.0.0.1",
        "port": 22,
        "username": "bastion",
        "authMethod": "password",
        "password": "AES256:encrypted..."
      }
    }
  ],
  "folders": [
    {
      "id": "a1b2c3d4e5f6",
      "name": "Production",
      "color": "#e05555",
      "parentFolder": null
    }
  ],
  "tunnels": [
    {
      "id": "tunnel123",
      "serverName": "production",
      "serverId": "production",
      "localPort": 8080,
      "remoteHost": "localhost",
      "remotePort": 80,
      "isActive": false,
      "autoStart": true
    }
  ]
}
```

### Шифрование

- Пароли шифруются алгоритмом **AES-256-CBC**
- Пароли расшифровываются только на вашем компьютере

---

## Разработка

```bash
# Установка зависимостей
npm install

# Компиляция
npm run compile

# Режим наблюдения
npm run watch

# Сборка VSIX
npm run package

# Установка локальной версии
code --install-extension vssh-0.1.0.vsix --force
```

---

## Структура проекта

```
vssh/
├── src/
│   ├── extension.ts        # Точка входа, регистрация команд
│   ├── serverProvider.ts   # Дерево серверов/папок, drag-and-drop
│   ├── sftpProvider.ts     # SFTP дерево с upload/download/edit
│   ├── sshConfig.ts        # Менеджер конфигурации с шифрованием
│   ├── sshConnection.ts    # SSH подключение через терминал
│   ├── tunnelManager.ts    # SSH туннели с автозапуском
│   ├── tunnelProvider.ts   # Провайдер дерева туннелей
│   └── types.ts            # TypeScript интерфейсы
├── images/
│   └── icon.png            # Иконка расширения
├── package.json            # Manifest расширения
├── tsconfig.json           # TypeScript конфигурация
└── README.md               # Документация
```

---

## Горячие клавиши

| Действие | Windows/Linux | macOS |
|----------|---------------|-------|
| Открыть палитру команд | Ctrl+Shift+P | Cmd+Shift+P |
| Открыть панель расширений | Ctrl+Shift+X | Cmd+Shift+X |
| Запустить отладку | F5 | F5 |

---

## Частые проблемы

### sshpass не найден

**Симптом:** При подключении с паролем появляется предупреждение

**Решение:**
```bash
# macOS
brew install sshpass

# Linux (Debian/Ubuntu)
sudo apt install sshpass

# Linux (RHEL/CentOS)
sudo yum install sshpass
```

### Туннель не создаётся

**Симптом:** Ошибка "Порт уже используется"

**Решение:**
- Проверьте занятость порта: `lsof -i :8080`
- Освободите порт или используйте другой
- Закройте старые туннели: **Close All Tunnels**

### Папки не отображаются

**Симптом:** Папки созданы, но не видны в дереве

**Решение:**
- Перезагрузите VS Code полностью (Cmd+Q / Quit)
- Проверьте консоль разработчика на ошибки

---

## Лицензия

MIT

---

## Ссылки

- [GitHub Repository](https://github.com/addspin/vssh)
- [Issues & Feature Requests](https://github.com/addspin/vssh/issues)
