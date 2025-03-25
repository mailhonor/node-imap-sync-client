# node-imap-sync-client

## 说明

网址: https://github.com/mailhonor/node-imap-sync-client

同步操作 imap 客户端， 见例子 examples

本imap客户端, 特点:
* 全部命令都是 promise 风格
* 主要用于和 IMAPD 服务器同步邮箱数据和邮件数据
* 支持文件夹的创建/删除/移动(改名)
* 支持邮件的复制/移动/删除/标记/上传
* 支持获取文件夹下邮件UID列表
* 读取邮件, 信封, 结构, 附件等
* 各种方法返回的邮箱文件夹名字都是 Buffer
  

## 接口 Type

### 对象初始化 选项
```ts
export type ImapSyncClientOptions = {
    user: string // 用户
    pass: string // 密码
    tryStartTLS?: boolean  // 如果服务器支持就启动 STARTTLS
    startTLS?: boolean // 是否启动 STARTTLS
    cmdIdInfo?: string // imap 命令 ID 的具体内容, 一般用于向服务器表明身份,
                       // 如: '("name" "linuxmail.cn" "abc" "def")'
} & socketSyncBuffer.options
```

### 回调函数类型, 记录通讯协议内容
```ts
export type ReadWriteRecordHandler = (
    type: string,   // type: read/write
    data: Buffer) => void
```

### 读取一行, 解析为一组 token
```ts
export type ResponseToken = {
    value: Buffer,
    children: ResponseToken[]
}

// 读取一行, 解析为一组 token
export type ReadOneLineResult = {
    tokens: ResponseToken[],
    extraDataLength: number, // 最后一个token 形如: {123}
    depth: number,
}
```

### 命令 status 结果解析
```ts
export type MboxStatus = {
    messages: number
    recent: number
    uidnext: number
    uidvalidity: number
    unseen: number
}
```

### 命令 list/lsub 返回的结果按行解析
```ts
export type MboxAttrs = {
    noinferiors: boolean
    noselect: boolean
    hierarchySplitor: string,
    inbox: boolean
    junk: boolean
    trash: boolean
    sent: boolean
    drafts: boolean
}
```

### 命令 select 返回的结果解析
```ts
export type MboxSelect = {
    exists: number
    recent: number
    uidvalidity: number
    uidnext: number
    highestmodseq: number
}
```

### 文件夹信息
```ts
export type MboxInfo = {
    mboxName: Buffer, // 文件夹名(Buffer), 返回的文件夹名字可能不是 imap-utf-7 编码
    mboxNameUtf8: string, // 文件夹名), 一定是 ""
    attrs: MboxAttrs
    status?: MboxStatus
    subscribed?: boolean
}
```

### 邮件标记
```ts
export type MailFlags = {
    answered?: boolean // 是否已回复
    seen?: boolean // 是否已读
    draft?: boolean // 是否草稿
    flagged?: boolean // 是否标记(星标)
    deleted?: boolean // 是否删除
}
```

### 邮件标记 + 邮件 UID, 用于邮件列表
```ts
export type MailUidWithFlags = {
    uid: number
} & MailFlags
```

### uidplus 扩展, 移动/复制/上传的结果
```ts
export type UidplusResult = {
  uidvalidity: number,
  uid: number
}
```

### 信封
```ts
export type EnvelopeAddress = {
    name: Buffer;
    nameUtf8: string;
    address: string;
}

// 为null, 表示字段不存在
export type EnvelopeAttrs = {
    uid: number,
    size: number,
    date: string,
    subject: Buffer,
    subjectUtf8: string,
    from: EnvelopeAddress | null,
    sender: EnvelopeAddress | null,
    to: EnvelopeAddress[] | null,
    cc: EnvelopeAddress[] | null,
    bcc: EnvelopeAddress[] | null,
    replyTo: EnvelopeAddress[] | null,
    inReplyTo: string,
    messageId: string,
    flags: MailFlags,
}
```

### 结构

```ts
export type BodyStructure = {
    textMimes: MimeNode[], // 文本可读可显示的节点
    showMimes: MimeNode[], // 如上, 且首先需要显示的
    attachmentMimes: MimeNode[], // 附件类节点
    topMime: MimeNode,
}
```

### 信封 + 结构

```ts
export type MailInfo = {
} & BodyStructure & Envelope
```

## 使用方法

见例子: examples/imap.js

### 创建对象

```ts
const imapSyncClient = require("imap-sync-sclient")
let ic = new imapSyncClient.imapSyncClient({
  host: "127.0.0.1",
  port: 143,
  user: "test@linuxmail.cn",
  pass: "password",
  tryStartTLS: true,
})
```

### 打开连接并初始化

打开imap连接,并认证等, 使用者可以自己实现类似的方法
```ts
// 返回 null 表示网络错误, 否则返回 boolean 值, true 表示成功
async open()
```

### 发起 STARTTLS 握手

发起命令 STARTTLS, 然后开始 ssl 握手

```ts
// 返回 null 表示网络错误, 否则返回 boolean 值, true 表示成功
async cmdStartTLS();
```

### 读取welcome

```ts
// 返回 null 表示网络错误, 否则返回 Buffer
// open() 方法内会调用这个方法
async readWelcome()
```

### 命令 capability

```ts
// 执行执行命令 capability 并返回结果, 同时保存到缓存
async forceGetCapability()
// 首先从缓存中取值
async getCapability()
```

### 登录

现在只支持 login

```ts
// 返回 null 表示网络失败, 否则返回 boolean, true表示认证成功
// open() 方法会调用这个方法
async login()
```

###  命令 ID

open() 方法会调用这个方法

```ts
//  返回 null 表示网络失败, 否则返回 boolean, true表示认证成功
// idInfo 为空则使用对象初始化参数 cmdIdInfo
async cmdId(idInfo?: string)
```

### 命令 LIST/LSUB

```ts
//  返回 null 表示网络失败, 否则返回 mboxInfo[]
async getMboxList()
async getSubscribedMboxList()
// 获取文件夹全部信息(LIST + LSUB + STATUS)
async getAllMboxInfos()
```

### 命令 create, 创建文件夹

```ts
// 返回 null 表示网络失败, 否则返回 boolean, true表示成功
async createMbox(pathname: string | Buffer)
// 创建文件夹, 并订阅
async createAndSubscribeMbox(pathname: string | Buffer)
```

### 命令 delete, 删除文件夹

```ts
// 返回 null 表示网络失败, 否则返回 boolean, true表示成功
async deleteMbox(pathname: string | Buffer)
```

###  命令 subscribe, 订阅文件夹

```ts
// 返回 null 表示网络失败, 否则返回 boolean, true表示成功
async subscribeMbox(pathname: string | Buffer)
```

###  命令 unSubscribe, 取消订阅文件夹

```ts
// 返回 null 表示网络失败, 否则返回 boolean, true表示成功
async unSubscribeMbox(pathname: string | Buffer)
```

### 命令 rename, 文件夹改名

```ts
// 返回 null 表示网络失败, 否则返回 boolean, true表示成功
async renameMbox(fromPathname: string | Buffer, toPathname: string | Buffer)
```

### 命令 select, 选择(打开)文件夹

```ts
// 返回 null 表示网络失败, 返回 false 表示不存在, 否则返回 mboxSelect
// 命令 select, 选择(打开) 文件夹
async forceSelectMbox(pathname: string | Buffer)
// 如过select的文件夹不变,则直接返回成功
async selectMbox(pathname: string | Buffer)
```

### 命令 UID MOVE, 移动邮件

```ts
// 返回 null 表示网络失败, 否则返回 boolean, true表示成功
// 一封
async moveOneMail(uid: number | string, toPathname: string | Buffer, options?: {
  callbackForUidplus?: { (r: { uidvalidity: number, uid: number }): void }
})
// 多封
async moveMail(uids: string, toPathname: string | Buffer, options?: {})
```

### 命令 UID COPY, 复制邮件

```ts
// 返回 null 表示网络失败, 否则返回 boolean, true表示成功
// 一封
async copyOneMail(uid: number | string, toPathname: string | Buffer, options?: {
  callbackForUidplus?: { (r: { uidvalidity: number, uid: number }): void }
})
// 多封
async copyMail(uids: string, toPathname: string | Buffer, options?: {})
```

 ### 命令 UID STORE, 设置标记

```ts
// 返回 null 表示网络失败, 否则返回 boolean, true表示成功
async setMailFlag(uidOrUids: number | string, flags: mailFlags, set_or_unset?: boolean)
async unsetMailFlag(uidOrUids: number | string, flags: mailFlags)
```

### 删除信件, UID

```ts
// 返回 null 表示网络失败, 否则返回 boolean, true表示成功
async deleteMail(uidOrUids: number | string)
```

### 获取邮件列表 UID + 标记

```ts
// 返回 null 表示网络失败, 否则返回 mailUidWithFlags[]
async fetchUidListWithFlags()
```

### 通过搜索命令, 获取邮件 UID 列表

```ts
// 返回 null 表示网络失败, 否则返回 number[]

//  全部邮件
async searchAllUids()
// 全部未读邮件
async searchUnseenUids()
// 全部已回复邮件
async searchAnsweredUids()
// 全部设置了已删除标记的邮件
async searchDeletedUids()
// 全部草稿邮件
async searchDraftUids()
// 全部flagged(星标)邮件
async searchFlaggedUids()
```

### 搜索

```ts
// 返回 null 表示网络失败, 否则返回 UID 数组
// querys: 形如:
//         CHARSET UTF-8 FLAGGED SINCE 1-Feb-2001
//         SUBJECT "Linux is good"
//         CC "admin@a.com" TEXT abc
async searchMail(querys: string)
```

### 命令 append, 上传信件

```ts
// 返回 null 表示网络失败, 否则返回 boolean, true表示成功
// callbackForMailPieceData, 多次调用, 返回上传的信件的部分数据,读够mailSize就不在执行
// options.callbackForUidplus, 如果支持 uidplus 协议, 则执行
async appendMail(mboxname: Buffer | string, mailSize: number,
  callbackForMailPieceData: { (): Promise<Buffer | null> },
  options?: {
    flags?: mailFlags
    date?: any /* string, unix-time, Date */
    callbackForUidplus?: { (r: uidplusResult): void }
  })
```

### 获取一封信件的信封信息
```ts
// 返回 null 表示网络失败, false 表示 信件不存在
async fetchEnvelope(uid: string | number): Promise<EnvelopeAttrs | false | null>
```

### 获取一封信件的结构信息
```ts
    async fetchMailStructure(uid: number | string): Promise<BodyStructure | false | null>
```

### 获取一封信件的信息(信封+结构)
```ts
    async fetchMailInfo(uid: number | string): Promise<MailInfo | false | null>;
```

### 获取一封信件
```ts
// 返回 null 表示网络失败, 否则返回 boolean, true表示成功
async fetchMailData(uid: number,
  callbackForMailPieceData: { (pieceData: Buffer): Promise<boolean> },  // 一部分一部分的返回信件内容,
  options?: {
    partial?: {
        offset: number,
        length: number,
    },
  }
)
```

### 获取一封信件的信头
```ts
// 返回 null 表示网络失败, 否则返回 boolean, true表示成功
async fetchMailHeader(uid: number,
  callbackForMailPieceData: { (pieceData: Buffer): Promise<boolean> },  // 一部分一部分的返回信件内容,
  options?: {
    partial?: {
        offset: number,
        length: number,
    },
  }
)
```

### 获取一封信件部分的数据
```ts
// 返回 null 表示网络失败, 否则返回 boolean, true表示成功
async fetchMimeDataBySection(uid: number | string,
    section: string,
    callbackForMailPieceData: { (pieceData: Buffer): Promise<boolean> },
    options?: {
        partial?: {
            offset: number,
            length: number,
        },
    })
```

### 获取一封信件部分的HEADER
```ts
// 返回 null 表示网络失败, 否则返回 boolean, true表示成功
async fetchMimeHeaderBySection(uid: number | string,
    section: string,
    callbackForMailPieceData: { (pieceData: Buffer): Promise<boolean> },
    options?: {
        partial?: {
            offset: number,
            length: number,
        },
    })
```


### imap 返回结果 OK/NO/BAD

```ts
// 返回 boolean
resultIsOk()
resultIsNo()
resultIsBad()
```

### 也许服务器有新的信件, 回调

```ts
setMaybeHaveNewMailHandler(handler: (pathname: Buffer) => any)
```

### 编译字符串

```ts
escape(str: string | Buffer): string | Buffer
// 例如:
escape("a\nb\"c") => "a\\nb\"c"
// 或
escape("a\nb\"c") => {5}
a

b"c
```

### 其他

```ts
// 设置调试模式
setDebugMode(tf = true)

// 设置回调函数,记录通讯协议
setReadWriteRecordHandler(handler: readWriteRecordHandler)

// 返回协议的最后一行
getLastReadedBuffer(): Buffer

// 是否网络错误
isNetError()

// 是否逻辑错误
isLogicError()

// 是否密码错误
isPasswordError()
```

## 扩展(基础) API

### 通用 IMAP 命令 封装

大部分IMAP命令可以靠这个基础封装实现

```ts
// 返回 null 表示网络失败, 否则返回 boolean, true表示成功
async generalCmd(cmdArgv: (Buffer | string)[], options?: {
  callbackForUntag?: { (data: Buffer[]): Promise<void> }
  callbackForTag?: { (data: Buffer[]): Promise<void> }
  [keys: string]: any
})
```

例如:

```ts
async _searchUidsByFlag(flag: string) {
  let uids: number[] = []
  let res = await this.generalCmd(["UID SEARCH ", flag], {
    callbackForUntag: async (tokens: Buffer[]) => {
      let i;
      for (i = 2; i < tokens.length; i++) {
        uids.push(parseInt(tokens[i].toString()))
      }
    },
  })
  if (!res) {
    return null
  }
  return uids
}
```

### 读取行数据,并解析为 tokens

```ts
// 读一行返回,并解析为 tokens
async readOneLineTokens()
// 读取一个完整的返回, 并解析为 tokens
async readTokens()
// 解析返回结果是不是 OK/NO/BAD
parseResult(tokens: Buffer[]): boolean
```

### 读写原始socket数据

见 this.socket, 见模块 socket-sync-buffer


## 字符集转码

见过太多不规范的文件夹名字, 以 "研发部" 为例子

```ts
合法的(imap-utf-7): &eBRT0ZDo-
不规范的(imap-utf-7): &eBRT0D-
非法的(utf-7): 研发部
非法的(GBK): 研发部
```
本库作者认为, 库不可能自动正确处理这些文件夹名字的解码, 而只是返回Buffer.

不做进一步的转码工作, 以保证通过 Buffer 能正确的操作这些文件夹

而文件夹的名字要最终转为UTF-8用于显示,使用者需要自己承担乱码的风险, 建议通过库 jschardet 来自动识别字符集

下面是规范的字符集转码方法:

```ts
// 
const imapSyncClient = require("imap-sync-sclient")

// 字符集转码: imap-utf-7 => utf-8 
function imapSyncClient.imapUtf7ToUtf8(str: string | Buffer): string

// 字符集转码: utf-8 => imap-utf-7
function imapSyncClient.utf8ToImapUtf7(str: string | Buffer): string
```