import { Buffer } from 'node:buffer';
import * as socketSyncBuffer from "socket-sync-buffer"
import iconv from "iconv-lite"
import { decodeValueToString, decodeParamValueToString } from "eml-parser-buffer"


const myParseInt = (a: any) => {
    let b = parseInt(a)
    if (isNaN(b)) return 0
    return b
}

// 对象初始化 选项
export type ImapSyncClientOptions = {
    user: string // 用户
    pass: string // 密码
    tryStartTLS?: boolean  // 如果服务器支持就启动 STARTTLS
    startTLS?: boolean // 是否启动 STARTTLS
    cmdIdInfo?: string // imap 命令 ID 的具体内容, 一般用于向服务器表明身份
} & socketSyncBuffer.options

// 回调函数类型, 记录通讯协议内容
export type ReadWriteRecordHandler = (
    type: string,   // type: read/write
    data: Buffer) => void

export type ResponseToken = {
    value: Buffer,
    quotedFlag: boolean,
    children: ResponseToken[]
}

// 读取一行, 解析为一组 token
export type ReadOneLineResult = {
    tokens: ResponseToken[],
    extraDataLength: number, // 最后一个token 形如: {123}
    depth: number,
}

// 命令 status 结果解析
export type MboxStatus = {
    messages: number
    recent: number
    uidnext: number
    uidvalidity: number
    unseen: number
}

// 命令 list 返回的结果按行解析
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

// 命令 select 返回的结果解析
export type MboxSelect = {
    exists: number
    recent: number
    uidvalidity: number
    uidnext: number
    highestmodseq: number
}

// 文件夹信息
export type MboxInfo = {
    mboxName: Buffer, // 文件夹名(Buffer), 返回的文件夹名字可能不是 imap-utf-7 编码
    mboxNameUtf8: string, // 文件夹名), 一定是 ""
    attrs: MboxAttrs
    status?: MboxStatus
    subscribed?: boolean
}

// 邮件标记
export type MailFlags = {
    answered?: boolean // 是否已回复
    seen?: boolean // 是否已读
    draft?: boolean // 是否草稿
    flagged?: boolean // 是否标记(星标)
    deleted?: boolean // 是否删除
}

// 邮件标记 + 邮件 UID, 用于邮件列表
export type MailUidWithFlags = {
    uid: number
} & MailFlags

// uidplus 扩展, 移动/复制/上传的结果
export type UidplusResult = {
    uidvalidity: number,
    uid: number
}

// 信封
export type MailAddress = {
    name: Buffer;
    nameUtf8: string;
    address: string;
}

export type Envelope = {
    uid: number,
    size: number,
    date: string,
    subject: Buffer | null,
    subjectUtf8: string,
    from: MailAddress | null,
    sender: MailAddress | null,
    to: MailAddress[] | null,
    cc: MailAddress[] | null,
    bcc: MailAddress[] | null,
    replyTo: MailAddress[] | null,
    inReplyTo: string | null,
    messageId: string | null,
    flags: MailFlags,
}

export type MimeNode = {
    type: string,
    subtype: string,
    charset: string,
    encoding: string,
    size: number,
    name: Buffer,
    nameUtf8: string,
    filename: Buffer,
    filenameUtf8: string,
    contentId: string,
    disposition: string,
    section: string,
    parent: MimeNode | null,
    children: MimeNode[],
}

export type BodyStructure = {
    textMimes: MimeNode[],
    showMimes: MimeNode[],
    attachmentMimes: MimeNode[],
    topMime: MimeNode,
}

export type MailInfo = {
} & BodyStructure & Envelope


// 字符集转码: imap-utf-7 => utf-8 
export function imapUtf7ToUtf8(str: string | Buffer): string {
    let bf: Buffer
    if (Buffer.isBuffer(str)) {
        bf = str
    } else {
        bf = Buffer.from(str)
    }
    let r = ""
    try {
        r = iconv.decode(bf, "utf7imap")
    } catch { }
    return r
}

// 字符集转码: utf-8 => imap-utf-7
export function utf8ToImapUtf7(str: string | Buffer): string {
    if (Buffer.isBuffer(str)) {
        str = str.toString()
    }
    let r = ""
    try {
        r = iconv.encode(str, "utf7imap").toString()
    } catch { }
    return r
}

export class imapSyncClient {
    private char_newline: number
    private char_backslash: number
    private char_quot: number
    private char_blank: number
    private char_star: number
    private char_left_parentheses: number
    private char_right_parentheses: number
    debugMode: boolean
    private readWriteRecorder: ReadWriteRecordHandler | null
    private lastReadedBuffer: Buffer
    private tag_id: number
    user: string
    pass: string
    private tryStartTLS: boolean
    private startTLS: boolean
    cmdIdInfo: string
    socket: socketSyncBuffer.socketSyncBuffer
    private logicErrorFlag: boolean
    private errorFlag: boolean
    private passwordErrorFlag: boolean
    private needCloseConnection: boolean
    private resultStatus: string
    private capability: string
    private lastSelectedMbox: Buffer
    private lastSelectedResult: MboxSelect | null
    private maybeHaveNewMailHandler: any = null

    constructor(options: ImapSyncClientOptions) {
        this.char_newline = "\n".charCodeAt(0)
        this.char_backslash = "\\".charCodeAt(0)
        this.char_quot = "\"".charCodeAt(0)
        this.char_blank = " ".charCodeAt(0)
        this.char_star = "*".charCodeAt(0)
        this.char_left_parentheses = "(".charCodeAt(0)
        this.char_right_parentheses = ")".charCodeAt(0)
        this.debugMode = false
        this.readWriteRecorder = null
        this.lastReadedBuffer = Buffer.allocUnsafe(0)
        this.tag_id = 1
        this.user = options.user
        this.pass = options.pass
        this.tryStartTLS = false
        this.startTLS = false
        if (options.tryStartTLS) {
            this.tryStartTLS = true
        }
        if (options.startTLS) {
            this.startTLS = true
        }
        this.cmdIdInfo = ""
        if (options.cmdIdInfo !== undefined) {
            this.cmdIdInfo = options.cmdIdInfo
        }
        this.socket = new socketSyncBuffer.socketSyncBuffer(options)
        this.errorFlag = false
        this.logicErrorFlag = false
        this.passwordErrorFlag = false
        this.needCloseConnection = false
        this.resultStatus = ""
        this.capability = ""
        this.lastSelectedMbox = Buffer.allocUnsafe(0)
        this.lastSelectedResult = null
    }
    setDebugMode(tf = true) {
        this.debugMode = tf
    }

    // 设置回调函数,记录通讯协议
    setReadWriteRecordHandler(handler: ReadWriteRecordHandler) {
        this.readWriteRecorder = handler
    }

    // 设置回调函数, 在操作中，是否有可能有新的信件
    setMaybeHaveNewMailHandler(handler: (pathname: Buffer) => any) {
        this.maybeHaveNewMailHandler = handler
    }

    private _checkMaybeHaveNewMail(tokens: ResponseToken[]): void {
        if (!this.maybeHaveNewMailHandler) {
            return
        }
        if (tokens.length < 3) {
            return
        }
        if (tokens[2].value.toString().toUpperCase() != "EXISTS") {
            return
        }
        this.maybeHaveNewMailHandler(this.lastSelectedMbox || Buffer.alloc(0))
    }

    //
    isNIL(token: ResponseToken): boolean {
        if (token.quotedFlag) {
            return false
        }
        if (token.value.toString() != "NIL") {
            return false
        }
        return true
    }

    // 协议的最后一行返回
    getLastReadedBuffer(): Buffer {
        return this.lastReadedBuffer
    }

    // 是否网络错误
    isNetError(): boolean {
        return this.errorFlag
    }

    // 是否逻辑错误
    isLogicError(): boolean {
        return this.logicErrorFlag
    }

    // 是否密码错误
    isPasswordError(): boolean {
        return this.passwordErrorFlag
    }

    escapeBuffer(bf: Buffer): Buffer {
        let needSize = false
        let needQuote = false
        let r = Buffer.alloc(bf.length * 2 + 16)
        let rlen = 0
        let i;
        r[rlen++] = this.char_quot
        for (i = 0; i < bf.length; i++) {
            let ch = bf[i]
            if (ch < 32) {
                needSize = true
                break
            }
            switch (ch) {
                case this.char_blank:
                case '{'.charCodeAt(0):
                    needQuote = true
                    break
                case this.char_quot:
                    needQuote = true
                    r[rlen++] = this.char_backslash
                    break
            }
            r[rlen++] = ch
        }
        r[rlen++] = this.char_quot
        if (needSize) {
            let prefix = Buffer.from("{" + bf.length + "}\r\n")
            return Buffer.concat([prefix, bf])
        }
        if (needQuote) {
            return r.subarray(0, rlen)
        }
        if (r.length == 2) {
            return r
        }
        return bf
    }

    escapeString(str: string): string {
        return this.escapeBuffer(Buffer.from(str)).toString()
    }

    // 按imap协议,编译(转义)数据
    escape(str: string | Buffer): string | Buffer {
        if (Buffer.isBuffer(str)) {
            return this.escapeBuffer(str)
        } else {
            return this.escapeBuffer(Buffer.from(str)).toString()
        }
    }

    private _get_ReadOneLineResult_tokens(lineResult: ReadOneLineResult): ResponseToken[] {
        let tokens = lineResult.tokens
        for (let i = 0; i < lineResult.depth; i++) {
            tokens = tokens[tokens.length - 1].children
        }
        return tokens
    }

    // 读一行返回,并解析为 tokens
    async complexReadOneLineTokens(lineResult?: ReadOneLineResult): Promise<ReadOneLineResult | null> {
        let that = this
        const result = await that.socket.gets(1024 * 1024 * 10)
        if (result === null) {
            that.errorFlag = true
            that.needCloseConnection = true
            return null
        }
        let ret: ReadOneLineResult = {
            tokens: [],
            extraDataLength: -1,
            depth: 0,
        }
        if (lineResult) {
            ret = lineResult
            ret.extraDataLength = -1;
        }
        let tokens: ResponseToken[] = that._get_ReadOneLineResult_tokens(ret)
        let last_quoted = false
        let bf = result
        let blen = bf.length
        let i = 0
        let ch: number
        if (blen > 0 && bf[blen - 1] == that.char_newline) {
            blen--
            bf = bf.subarray(0, blen)
        }
        if (blen > 0 && bf[blen - 1] == "\r".charCodeAt(0)) {
            blen--
            bf = bf.subarray(0, blen)
        }
        if (that.readWriteRecorder) {
            that.readWriteRecorder("read", bf)
        }
        that.lastReadedBuffer = bf
        if (that.debugMode) {
            console.log("imap read :", bf.toString())
        }
        while (i < blen) {
            let tmpbf = Buffer.allocUnsafe(bf.length + 1)
            let tmpbf_i = 0
            ch = that.char_blank
            while (i < blen) {
                ch = bf[i++]
                if (ch != that.char_blank) {
                    break
                }
            }
            if (ch == that.char_blank) {
                continue
            }
            if (ch == that.char_left_parentheses) {
                let token: ResponseToken = {
                    value: Buffer.allocUnsafe(0),
                    quotedFlag: false,
                    children: [],
                }
                tokens.push(token)
                ret.depth++
                tokens = that._get_ReadOneLineResult_tokens(ret)
                continue
            } else if (ch == that.char_right_parentheses) {
                ret.depth--
                tokens = that._get_ReadOneLineResult_tokens(ret)
                continue
            } else if (ch == that.char_quot) {
                last_quoted = true
                while (i < blen) {
                    ch = bf[i++]
                    if (ch == that.char_quot) {
                        let token: ResponseToken = {
                            value: tmpbf.subarray(0, tmpbf_i),
                            quotedFlag: true,
                            children: [],
                        }
                        tokens.push(token)
                        tmpbf_i = 0
                        break
                    } else if (ch == that.char_backslash) {
                        if (i == blen) {
                            that.needCloseConnection = true
                            that.logicErrorFlag = true
                            return null
                        }
                        ch = bf[i++]
                        tmpbf.writeUint8(ch, tmpbf_i++)
                    } else {
                        tmpbf.writeUint8(ch, tmpbf_i++)
                    }
                }
            } else {
                last_quoted = false
                tmpbf.writeUint8(ch, tmpbf_i++)
                while (i < blen) {
                    ch = bf[i++]
                    if (ch == that.char_blank) {
                        break
                    } else if (ch == that.char_left_parentheses) {
                        i--
                        break
                    } else if (ch == that.char_right_parentheses) {
                        i--
                        break
                    } else {
                        tmpbf.writeUint8(ch, tmpbf_i++)
                    }
                }
                let token: ResponseToken = {
                    value: tmpbf.subarray(0, tmpbf_i),
                    quotedFlag: false,
                    children: [],
                }
                tokens.push(token)
                tmpbf_i = 0
            }
        }
        //
        if (that.needCloseConnection) {
            return null
        }
        // last token maybe is {123}
        do {
            if (last_quoted) {
                break
            }
            if (tokens.length == 0) {
                break
            }

            let lastbf = tokens[tokens.length - 1].value
            if (lastbf.length < 3) {
                break
            }
            if (lastbf[0] != "{".charCodeAt(0) || lastbf[lastbf.length - 1] != "}".charCodeAt(0)) {
                break
            }
            let l = myParseInt(lastbf.subarray(1, lastbf.length - 1).toString())
            if (l < 0) {
                that.needCloseConnection = true
                that.logicErrorFlag = true
                return null
            }
            ret.extraDataLength = l
            tokens.pop()
        } while (0)

        //
        return ret
    }

    // 读取一个完整的返回, 并解析为 tokens
    async readTokens() {
        let result: ReadOneLineResult = {
            tokens: [],
            extraDataLength: -1,
            depth: 0,
        }
        while (1) {
            let tmpret = await this.complexReadOneLineTokens(result)
            if (!tmpret) {
                return null
            }
            result = tmpret
            if (result.extraDataLength < 0) {
                break
            }
            if (result.extraDataLength == 0) {
                let tokens = this._get_ReadOneLineResult_tokens(result)
                tokens.push({ value: Buffer.allocUnsafe(0), quotedFlag: false, children: [] })
            } else {
                let tmpbuf = await this.socket.readn(result.extraDataLength)
                if (tmpbuf === null) {
                    this.errorFlag = true
                    this.needCloseConnection = true
                    return null
                }
                let tokens = this._get_ReadOneLineResult_tokens(result)
                tokens.push({ value: tmpbuf, quotedFlag: true, children: [] })
            }
        }
        return result.tokens
    }

    // 解析 返回结果是不是 OK/NO/BAD
    parseResult(tokens: ResponseToken[]): boolean {
        if (tokens.length < 2 || tokens[1].value.length < 2) {
            this.needCloseConnection = true
            this.logicErrorFlag = true
            return false
        }
        let ch = tokens[1].value.subarray(0, 1).toString().toUpperCase()
        if (ch == "O") {
            this.resultStatus = "O"
        } else if (ch == "N") {
            this.resultStatus = "N"
        } else if (ch == "B") {
            this.resultStatus = "B"
        } else {
            this.needCloseConnection = true
            this.logicErrorFlag = true
            return false
        }
        return true
    }
    resultIsOk(): boolean {
        return this.resultStatus == "O"
    }
    resultIsNo(): boolean {
        return this.resultStatus == "N"
    }
    resultIsBad(): boolean {
        return this.resultStatus == "B"
    }

    // 通用 命令 封装
    async generalCmd(cmdArgv: (Buffer | string)[], options?: {
        callbackForUntag?: { (data: ResponseToken[]): void }
        callbackForTag?: { (data: ResponseToken[]): void }
        [keys: string]: any
    }): Promise<null | boolean> {
        let tag_id = "" + (this.tag_id++);
        let writeBuffers: Buffer[] = []
        writeBuffers.push(Buffer.from(tag_id + " "))
        cmdArgv.forEach(arg => {
            if (Buffer.isBuffer(arg)) {
                writeBuffers.push(arg)
            } else {
                writeBuffers.push(Buffer.from(arg))
            }
        })
        let cmdLine = Buffer.concat(writeBuffers)
        await this.socket.writeBuffer(cmdLine)
        await this.socket.write("\r\n")
        if (this.debugMode) {
            console.log("imap write:", cmdLine.toString())
        }
        if (this.readWriteRecorder) {
            this.readWriteRecorder("write", cmdLine)
        }
        if (options === undefined) {
            options = { callbackForUntag: undefined, callbackForTag: undefined }
        }
        while (1) {
            const tokens = await this.readTokens()
            if (tokens === null) {
                return null
            }
            if (tokens.length < 2) {
                this.needCloseConnection = true
                this.logicErrorFlag = true
                return null
            }
            let token = tokens[0].value.toString()
            if (token == "*") {
                if (options.callbackForUntag) {
                    options.callbackForUntag(tokens)
                }
                continue
            }
            if (token != tag_id) {
                continue
            }
            if (!this.parseResult(tokens)) {
                return null
            }
            if (options.callbackForTag) {
                options.callbackForTag(tokens)
            }
            if (this.resultIsOk()) {
                return true
            }
            return false
        }
        return true
    }

    // 发起 ssl 连接握手
    async cmdStartTLS(): Promise<boolean | null> {
        let res = await this.generalCmd(["STARTTLS"])
        if (res === null) {
            return null
        }
        if (res === false) {
            return false
        }
        res = await this.socket.tlsConnect()
        if (res === null) {
            return null
        }
        if (res === false) {
            return false
        }
        return true
    }

    // welcome
    async readWelcome(): Promise<true | null> {
        let tokens = await this.readTokens()
        if (tokens === null) {
            return null
        }
        return true
    }

    // 命令 capability
    async getCapability(): Promise<string | null> {
        if (this.capability.length > 0) {
            return this.capability
        }
        return this.forceGetCapability()
    }

    async forceGetCapability(): Promise<string | null> {
        let that = this
        let r = await that.generalCmd(["CAPABILITY"], {
            callbackForUntag: (tokens: ResponseToken[]) => {
                if (tokens[1].value.toString().toUpperCase() == "CAPABILITY") {
                    that.capability = " " + tokens.slice(2).map(b => b.value.toString()).join(" ").toUpperCase() + " "
                }
            },
        })
        if (r === null) {
            return r
        }
        return this.capability
    }

    // 登录
    async login(): Promise<boolean | null> {
        return this.generalCmd([("LOGIN " + this.escapeString(this.user) + " " + this.escapeString(this.pass))], {
            callbackForTag: (tokens: ResponseToken[]) => {
                if (tokens.length > 2 && tokens[2].value.toString().toUpperCase() == "[CAPABILITY") {
                    this.capability = " " + tokens.slice(2).map(b => b.value.toString()).join(" ").toUpperCase() + " "
                }
            },
        })
    }

    // 命令 ID, id 后面的具体内容 可以在 options 中设置
    async cmdId(idInfo?: string): Promise<boolean | null> {
        if (idInfo === undefined || idInfo == "") {
            idInfo = this.cmdIdInfo
        }
        if (idInfo == "") {
            idInfo = '("name" "linuxmail.cn")'
        }
        return this.generalCmd(["ID " + idInfo])
    }

    // 命令 noop
    async cmdNoop(): Promise<boolean | null> {
        return this.generalCmd(["NOOP"])
    }

    // 命令 LIST/LSUB
    private async _cmdListOrLsub(listOrLsub: string): Promise<MboxInfo[] | null> {
        let foundInbox = false
        let mboxs: MboxInfo[] = []
        let res = await this.generalCmd([listOrLsub + " \"\" *"], {
            callbackForUntag: (tokens: ResponseToken[]) => {
                if (tokens.length < 4) {
                    return
                }
                let mboxName = tokens[tokens.length - 1].value
                let info: MboxInfo = {
                    mboxName,
                    mboxNameUtf8: "",
                    attrs: {
                        noinferiors: false,
                        noselect: false,
                        hierarchySplitor: tokens[tokens.length - 2].value.toString()[0],
                        inbox: false,
                        junk: false,
                        trash: false,
                        sent: false,
                        drafts: false,
                    }
                }
                if (!foundInbox) {
                    if (mboxName.toString().toLowerCase() == "inbox") {
                        info.attrs.inbox = true
                        foundInbox = true
                    }
                }
                mboxs.push(info)
                if (tokens.length == 4) {
                    return
                }
                tokens[2].children.forEach(tokenBuffer => {
                    let s = tokenBuffer.value.toString().replace("\\", "").toLowerCase()
                    if (s in info.attrs) {
                        (info.attrs as any)[s] = true
                    }
                })
            },
        })
        if (!res) {
            return null
        }
        return mboxs
    }

    async getMboxList(): Promise<MboxInfo[] | null> {
        return this._cmdListOrLsub("LIST")
    }

    async getSubscribedMboxList(): Promise<MboxInfo[] | null> {
        return this._cmdListOrLsub("LSUB")
    }

    // 命令 status
    async getMboxStatus(mboxName: string | Buffer, items?: string): Promise<MboxStatus | false | null> {
        // S status abc (MESSAGES RECENT UIDNEXT UIDVALIDITY UNSEEN)
        // * STATUS abc (MESSAGES 123 RECENT 1 UIDNEXT 328 UIDVALIDITY 166 UNSEEN 9)
        // S OK Status completed (0.001 + 0.000 secs).
        let status: MboxStatus = { messages: -1, recent: 0, uidnext: -1, uidvalidity: -1, unseen: 0, }
        if (items === undefined) {
            items = "(MESSAGES RECENT UIDNEXT UIDVALIDITY UNSEEN)"
        }
        let res = await this.generalCmd(["STATUS ", this.escape(mboxName), (" " + items)], {
            callbackForUntag: (tokens: ResponseToken[]) => {
                if (tokens.length < 4) {
                    return
                }
                let stokens = tokens[3].children
                for (let i = 0; i < stokens.length; i += 2) {
                    if (i + 1 == stokens.length) {
                        break
                    }
                    let key = stokens[i].value.toString().toLowerCase()
                    let val = myParseInt(stokens[i + 1].value.toString())
                    if (key in status) {
                        (status as any)[key] = val
                    }
                }
            },
        })
        if (res === null) {
            return null
        }
        if (status.messages < 0) {
            return false
        }
        return status
    }

    // 获取所有文件夹的详细信息
    async getAllMboxInfos(): Promise<MboxInfo[] | null> {
        // imap mbox list
        let mboxs = await this.getMboxList()
        if (mboxs === null) {
            return null
        }
        // imap mbox lsub
        const lsub = await this.getMboxList()
        if (lsub === null) {
            return null
        }
        // who subscribed?
        let lsubSet: any = {}
        lsub.forEach(f => {
            lsubSet[f.mboxName.toString("binary")] = true
        })
        mboxs.forEach(f => {
            if (f.mboxName.toString("binary") in lsubSet) {
                f.subscribed = true
            }
        })
        // imap fodler status one by one
        let i;
        for (i = 0; i < mboxs.length; i++) {
            let fo = mboxs[i]
            let status = await this.getMboxStatus(fo.mboxName)
            if (status) {
                fo.status = status
            }
        }
        return mboxs
    }

    // 命令 select
    async selectMbox(mboxName: string | Buffer): Promise<MboxSelect | null | false> {
        let infos: MboxSelect = {
            exists: -1,
            recent: 0,
            uidvalidity: -1,
            uidnext: -1,
            highestmodseq: -1
        }
        if (!Buffer.isBuffer(mboxName)) {
            mboxName = Buffer.from(mboxName)
        }
        if (mboxName.equals(this.lastSelectedMbox)) {
            return this.lastSelectedResult || infos
        }

        this.lastSelectedMbox = Buffer.alloc(0)
        let res = await this.generalCmd(["SELECT ", this.escape(mboxName)], {
            callbackForUntag: (tokens: ResponseToken[]) => {
                if (tokens.length < 3) {
                    return
                }
                let key = tokens[2].value.toString().toLowerCase()
                if (key[0] == "") {
                    return
                }
                if (key[0] == "[") {
                    if (tokens.length < 4) {
                        return
                    }
                    if (key.substring(1) in infos) {
                        (infos as any)[key.substring(1)] = myParseInt(tokens[3].value.toString().replace("]", ""))
                    }
                    return
                } else {
                    if (key in infos) {
                        (infos as any)[key] = myParseInt(tokens[1].value.toString())
                    }
                }
            },
        })
        if (!res) {
            return null
        }
        if (infos.exists == -1) {
            return false
        }
        this.lastSelectedMbox = mboxName
        this.lastSelectedResult = infos
        return infos
    }

    // 命令 select, 强制执行 select
    async forceSelectMbox(mboxName: string | Buffer): Promise<MboxSelect | null | false> {
        this.lastSelectedMbox = Buffer.allocUnsafe(0)
        return this.selectMbox(mboxName)
    }

    // 解析 邮件标记
    private _decode_mail_flags(tokens: ResponseToken[]): MailFlags {
        let flags: MailFlags = {
            answered: false, seen: false, draft: false, flagged: false, deleted: false
        }
        let stop = false
        let i = 0;
        for (i = 0; i < tokens.length; i++) {
            if (stop) {
                break
            }
            let key = tokens[i].value.subarray(0, 32).toString()
            if (key.length && key[0] == "(") {
                key = key.substring(1)
            }
            if (key.length && key[0] == "\\") {
                key = key.substring(1)
            }
            if (key.length && key[key.length - 1] == ")") {
                stop = true
                key = key.substring(0, key.length - 1)
            }
            if (key.length && key[key.length - 1] == ")") {
                key = key.substring(0, key.length - 1)
            }
            if (key == "") {
                continue
            }
            key = key.toLowerCase()
            if (key in flags) {
                (flags as any)[key] = true
            }
        }
        return flags
    }

    // 编码 邮件标记
    private _encode_mail_flags(flags: MailFlags): string {
        let fs: string[] = [];
        if (flags.answered === true) {
            fs.push("\\Answered")
        }
        if (flags.seen === true) {
            fs.push("\\Seen")
        }
        if (flags.draft === true) {
            fs.push("\\Draft")
        }
        if (flags.flagged === true) {
            fs.push("\\Flagged")
        }
        if (flags.deleted === true) {
            fs.push("\\Deleted")
        }
        return "(" + fs.join(" ") + ")"
    }

    // 获取邮件列表 UID + 标记
    async fetchUidListWithFlags(): Promise<MailUidWithFlags[] | null> {
        if (!this.lastSelectedResult || this.lastSelectedResult.exists == 0) {
            return []
        }
        let uids: MailUidWithFlags[] = []
        let res = await this.generalCmd(["FETCH 1:* (UID FLAGS)"], {
            callbackForUntag: (tokens: ResponseToken[]) => {
                if (tokens.length < 4) {
                    return
                }
                let ftokens = tokens[3].children
                if (ftokens.length < 4) {
                    return
                }
                const uid = myParseInt(ftokens[1].value.toString())
                const flags = this._decode_mail_flags(ftokens[3].children)
                uids.push({ uid, ...flags })
            },
        })
        if (!res) {
            return null
        }
        return uids
    }

    //  s search cc a
    // * SEARCH 9
    // * 13 FETCH (FLAGS (\Seen))
    // * 15 FETCH (FLAGS (\Seen))
    // * 18 EXISTS
    // s OK Search completed (0.001 + 0.000 secs).
    async searchMail(querys: string): Promise<number[] | null> {
        let that = this
        let uids: number[] = []
        let res = await this.generalCmd(["UID SEARCH ", querys], {
            callbackForUntag: (tokens: ResponseToken[]) => {
                if (tokens.length < 3) {
                    return
                }
                that._checkMaybeHaveNewMail(tokens)
                if (tokens[1].value.toString().toUpperCase() != "SEARCH") {
                    return
                }
                for (let i = 2; i < tokens.length; i++) {
                    uids.push(myParseInt(tokens[i].value.toString()))
                }
            },
        })
        if (!res) {
            return null
        }
        return uids
    }

    // 通过搜索命令, 获取当前文件夹, 全部邮件
    async searchAllUids(): Promise<number[] | null> {
        return this.searchMail("ALL")
    }
    // 通过搜索命令, 获取当前文件夹, 全部未读邮件
    async searchUnseenUids(): Promise<number[] | null> {
        return this.searchMail("UNSEEN")
    }
    // 通过搜索命令, 获取当前文件夹, 全部已回复邮件
    async searchAnsweredUids(): Promise<number[] | null> {
        return this.searchMail("ANSWERED")
    }
    // 通过搜索命令, 获取当前文件夹, 全部设置了已删除标记的邮件
    async searchDeletedUids(): Promise<number[] | null> {
        return this.searchMail("DELETED")
    }
    // 通过搜索命令, 获取当前文件夹, 全部草稿邮件
    async searchDraftUids(): Promise<number[] | null> {
        return this.searchMail("DRAFT")
    }
    // 通过搜索命令, 获取当前文件夹, 全部flagged(星标)邮件
    async searchFlaggedUids(): Promise<number[] | null> {
        return this.searchMail("FLAGGED")
    }

    // 命令 create, 创建文件夹
    async createMbox(mboxName: string | Buffer): Promise<boolean | null> {
        let r = await this.generalCmd(["CREATE ", this.escape(mboxName)])
        if (r === null) {
            return null
        }
        if (r == true) {
            return true
        }
        return false
    }

    // 创建文件夹, 并订阅
    async createAndSubscribeMbox(mboxName: string | Buffer): Promise<boolean | null> {
        let r = await this.createMbox(mboxName)
        if (r !== true) {
            return r
        }
        return await this.subscribeMbox(mboxName);
    }

    // 命令 delete, 删除文件夹
    async deleteMbox(mboxName: string | Buffer): Promise<true | null> {
        let r = await this.generalCmd(["DELETE ", this.escape(mboxName)])
        if (r === null) {
            return null
        }
        return true
    }

    // 命令 subscribe, 订阅文件夹
    async subscribeMbox(mboxName: string | Buffer): Promise<boolean | null> {
        let r = await this.generalCmd(["SUBSCRIBE ", this.escape(mboxName)])
        return r
    }

    // 命令 unSubscribe, 取消订阅文件夹
    async unSubscribeMbox(mboxName: string | Buffer): Promise<boolean | null> {
        let r = await this.generalCmd(["UNSUBSCRIBE ", this.escape(mboxName)])
        return r
    }

    // 命令 rename, 文件夹改名
    async renameMbox(fromMboxName: string | Buffer, toMboxName: string | Buffer): Promise<boolean | null> {
        let r = await this.generalCmd(["RENAME ", this.escape(fromMboxName), " ", this.escape(toMboxName)])
        return r
    }

    // 打开imap连接,并认证等
    // 使用者可以自己实现类似的方法
    async open(): Promise<boolean | null> {
        if (! await this.socket.connect()) {
            return false
        }
        if (! await this.readWelcome()) {
            return false
        }
        if (! await this.getCapability()) {
            return false
        }

        let tlsGo = this.startTLS
        if (!tlsGo && this.tryStartTLS) {
            if (this.capability.indexOf(" STARTTLS ") > -1) {
                tlsGo = true
            }
        }
        if (tlsGo) {
            let r = await this.cmdStartTLS()
            if (r === null) {
                this.errorFlag = true
                this.needCloseConnection = true
                return null
            }
            if (!r) {
                return false
            }
        }

        switch (await this.login()) {
            case null:
                return false
            case false:
                return false
            case true:
                break
        }
        if (!this.resultIsOk()) {
            return false
        }

        if (this.capability.indexOf(" ID ") > -1) {
            if (!await this.cmdId()) {
                return false
            }
        }

        return true
    }

    // 命令 logout, 退出登录
    async logout(): Promise<true | null> {
        let r = await this.generalCmd(["LOGOUT"])
        this.socket.close()
        if (r === null) {
            return null
        }
        return true
    }

    // 命令 append, 上传信件
    // A003 APPEND saved-messages (\Seen) {326}
    async appendMail(mboxName: Buffer | string, mailSize: number,
        callbackForMailPieceData: () => Promise<Buffer | null>,
        options?: {
            flags?: MailFlags
            date?: Date,
            callbackForUidplus?: (r: UidplusResult) => any,
        }): Promise<boolean | null> {
        let that = this
        if (!Buffer.isBuffer(mboxName)) {
            mboxName = Buffer.from(mboxName)
        }
        options = options || {}
        // cmd
        let tag_id = "" + (that.tag_id++);
        let writeBuffers: Buffer[] = []
        writeBuffers.push(Buffer.from(tag_id + " APPEND "))
        writeBuffers.push(that.escapeBuffer(mboxName))
        if (options.flags) {
            let flags = that._encode_mail_flags(options.flags)
            if (flags != "()") {
                writeBuffers.push(Buffer.from(" "))
                writeBuffers.push(Buffer.from(flags))
            }
        }
        options.date = new Date()
        if (options.date) {
            let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
            let d = options.date
            let r = " \""
            r += d.getDate() + "-" + months[d.getMonth()] + "-" + d.getFullYear() + " "
            r += d.toTimeString().split(" (")[0]
            r += "\""
            writeBuffers.push(Buffer.from(r))
        }
        writeBuffers.push(Buffer.from(" {" + mailSize + "}"))

        let cmdLine = Buffer.concat(writeBuffers)
        await that.socket.writeBuffer(cmdLine)
        await that.socket.write("\r\n")

        if (that.debugMode) {
            console.log("imap write:", cmdLine.toString())
        }
        if (that.readWriteRecorder) {
            that.readWriteRecorder("write", Buffer.from(cmdLine))
        }

        // 读取返回, 期望: 
        // + Ready for literal data
        const tokens = await that.readTokens()
        if (tokens === null) {
            return null
        }
        if (tokens.length < 1) {
            that.logicErrorFlag = true
            return null
        }
        if (tokens[0].value.toString() != "+") {
            return false
        }

        // 写数据(信件)
        let leftSize = mailSize
        while (leftSize > 0) {
            let bf = await callbackForMailPieceData()
            if (bf === null) {
                that.logicErrorFlag = true
                return null
            }
            leftSize -= bf.length
            if (!that.socket.writeBuffer(bf)) {
                that.errorFlag = true
                return null
            }
        }
        if (!that.socket.write("\r\n")) {
            that.errorFlag = true
            return null
        }
        if (!that.socket.flush()) {
            that.errorFlag = true
            return null
        }

        // 读取返回
        function _parse_append_result(tokens: ResponseToken[]): UidplusResult {
            let r: UidplusResult = {
                uidvalidity: -1,
                uid: -1
            }
            for (let i = 2; i < tokens.length; i++) {
                let t = tokens[i].value.toString()
                if (t != "[APPENDUID") {
                    continue
                }
                i++
                if (i == tokens.length) {
                    break;
                }
                r.uidvalidity = myParseInt(tokens[i].value.toString())
                i++
                if (i == tokens.length) {
                    break;
                }
                r.uid = myParseInt(tokens[i].value.toString())
                break
            }
            return r
        }

        while (1) {
            const tokens = await that.readTokens()
            if (tokens === null) {
                return null
            }
            let token = tokens[0].value.toString()
            if (token == "*") {
                that._checkMaybeHaveNewMail(tokens)
                continue
            }
            if (token != tag_id) {
                continue
            }
            if (!that.parseResult(tokens)) {
                return null
            }
            if (options && options.callbackForUidplus) {
                let r = _parse_append_result(tokens)
                options.callbackForUidplus(r)
            }
            if (that.resultIsOk()) {
                return true
            }
            return false
        }

        //
        return true
    }

    // 解析 move/copy 的返回(uidplus)
    // * OK [COPYUID 1683689640 20:22 33:35] Moved UIDs
    // 只解析 移动/复制 一封信件的情况, 作者认为:
    //    1, 大部分情况,一封一封的移动能满足使用者的需求
    //    2, 如果移动多封或者全部邮件, 使用者大概率不会关注uidplus的结果
    private _parse_move_copy_uidplus_result(tokens: ResponseToken[]): UidplusResult {
        let r: UidplusResult = {
            uidvalidity: -1,
            uid: -1
        }
        if (tokens.length < 3) {
            return r
        }
        if (tokens[1].value.length < 2) {
            return r
        }
        if (String.fromCharCode(tokens[1].value[0]).toUpperCase() != 'O') {
            return r
        }
        if (tokens[2].value.toString().toUpperCase() != "[COPYUID") {
            return r
        }
        if (tokens.length < 6) {
            return r
        }
        r.uidvalidity = myParseInt(tokens[3].value.toString())
        r.uid = myParseInt(tokens[5].value.toString())
        if (r.uidvalidity == -1 || r.uid == -1) {
            r.uidvalidity = -1
            r.uid = -1
        }
        return r
    }

    private async _move_copy_one_mail(CMD: string, uid: number | string, toMboxName: string | Buffer, options?: {
        callbackForUidplus?: (r: { uidvalidity: number, uid: number }) => any
    }) {
        let uidplus: UidplusResult = {
            uidvalidity: -1,
            uid: -1
        }
        let cmdOptions = {
        }
        if (options && options.callbackForUidplus) {
            cmdOptions = {
                callbackForUntag: (tokens: ResponseToken[]) => {
                    if (uidplus.uidvalidity == -1) {
                        uidplus = this._parse_move_copy_uidplus_result(tokens)
                    }
                },
                callbackForTag: (tokens: ResponseToken[]) => {
                    if (uidplus.uidvalidity == -1) {
                        uidplus = this._parse_move_copy_uidplus_result(tokens)
                    }
                },
            }
        }
        let r = await this.generalCmd([CMD + " " + uid + " ", this.escape(toMboxName)], cmdOptions)
        if (options && options.callbackForUidplus) {
            options.callbackForUidplus(uidplus)
        }
        return r
    }

    // 命令 UID MOVE, 移动一封邮件
    async moveMail(uid: number | string, toMboxName: string | Buffer, options?: {
        callbackForUidplus?: (r: { uidvalidity: number, uid: number }) => any,
    }): Promise<boolean | null> {
        return this._move_copy_one_mail("UID MOVE", uid, toMboxName, options)
    }

    // 命令 UID COPY, 复制一封邮件
    async copyMail(uid: number | string, toMboxName: string | Buffer, options?: {
        callbackForUidplus?: (r: { uidvalidity: number, uid: number }) => any,
    }): Promise<boolean | null> {
        return this._move_copy_one_mail("UID COPY", uid, toMboxName, options)
    }

    //
    private async _set_mail_flag(CMD: string, uid: number | string, flags: MailFlags, set_or_unset: boolean) {
        let fs = this._encode_mail_flags(flags)
        if (fs == "()") {
            return true
        }
        return this.generalCmd([CMD + " " + uid + " ", set_or_unset ? "+" : "-", "FLAGS.SILENT ", fs])
    }
    // 命令 UID STORE, 设置标记
    async setMailFlag(uidOrUids: number | string, flags: MailFlags, set_or_unset?: boolean): Promise<boolean | null> {
        return this._set_mail_flag("UID STORE", uidOrUids, flags, (set_or_unset !== false))
    }
    async unsetMailFlag(uidOrUids: number | string, flags: MailFlags) {
        return this._set_mail_flag("UID STORE", uidOrUids, flags, false)
    }

    // expunge
    async expunge(): Promise<boolean | null> {
        let that = this
        let res = await this.generalCmd(["EXPUNGE"], {
            callbackForUntag: (tokens: ResponseToken[]) => {
                if (tokens.length < 3) {
                    return
                }
                that._checkMaybeHaveNewMail(tokens)
            },
        })
        return res
    }

    async setMailFlagAndExpunge(uidOrUids: number | string, flags: MailFlags, set_or_unset?: boolean): Promise<boolean | null> {
        let r = await this.setMailFlag(uidOrUids, flags, set_or_unset)
        if (!r) {
            return r
        }
        r = await this.expunge()
        return r
    }

    async unsetMailFlagAndExpunge(uidOrUids: number | string, flags: MailFlags): Promise<boolean | null> {
        return this.setMailFlagAndExpunge(uidOrUids, flags, false)
    }

    // 删除信件, UID
    async deleteMail(uidOrUids: number | string): Promise<boolean | null> {
        let r = await this.setMailFlag(uidOrUids, { deleted: true })
        if (r !== true) {
            return r
        }
        r = await this.expunge()
        return r
    }

    // 删除信件
    parseEnvelope(tokens: ResponseToken[]): Envelope | null {
        let o: Envelope = {
            uid: -1,
            size: -1,
            flags: {},
        } as any
        if (!this._parse_envelope(o, tokens)) {
            return null
        }
        return o
    }

    private _parse_envelope(o: Envelope, tokens: ResponseToken[]): boolean {
        let that = this
        if (tokens.length < 10) {
            return false
        }

        o.date = tokens[0].value.toString()
        o.subject = tokens[1].value
        if (this.isNIL(tokens[1])) {
            o.subject = null
            o.subjectUtf8 = ""
        } else {
            o.subjectUtf8 = decodeValueToString(o.subject)
        }

        // 0: date, 1: subject, 2: from, 3: sender, 4: reply-to, 5: to, 6: cc, 7: bcc, 8: in-reply-to, and 9: message-id.
        // The date, subject, in-reply-to, and message-id fields are strings.
        // The from, sender, reply-to, to, cc, and bcc fields are parenthesized lists of address structures.

        let a: MailAddress
        function toEnvelopeAddress(tokens: ResponseToken[]) {
            let ea: MailAddress = {
                name: Buffer.allocUnsafe(0),
                nameUtf8: "",
                address: "",
            }
            if (tokens.length != 4) {
                return ea
            }
            ea.name = tokens[0].value
            ea.nameUtf8 = decodeValueToString(tokens[0].value)
            let s = tokens[2].value.toString()
            if (s != "NIL") {
                ea.address = s
            }
            s = tokens[3].value.toString()
            if (s != "NIL") {
                if (ea.address != "") {
                    ea.address += "@"
                }
                ea.address += s
            }
            return ea
        }
        if (tokens[2].children.length) {
            o.from = toEnvelopeAddress(tokens[2].children[0].children)
        }
        if (tokens[3].children.length) {
            o.sender = toEnvelopeAddress(tokens[3].children[0].children)
        }
        function toEnvelopeAddress_s(token: ResponseToken) {
            if (that.isNIL(token)) {
                return null
            }
            let rs: any[] = []
            let tokens = token.children
            if (tokens.length) {
                tokens.forEach(ch => {
                    let tmpo = toEnvelopeAddress(ch.children)
                    if (tmpo) {
                        rs.push(tmpo)
                    }
                })
            }
            return rs
        }
        o.replyTo = toEnvelopeAddress_s(tokens[4])
        o.to = toEnvelopeAddress_s(tokens[5])
        o.cc = toEnvelopeAddress_s(tokens[6])
        o.bcc = toEnvelopeAddress_s(tokens[7])

        o.inReplyTo = tokens[8].value.toString()
        if (that.isNIL(tokens[8])) {
            o.inReplyTo = null
        }
        o.messageId = tokens[9].value.toString()
        if (that.isNIL(tokens[9])) {
            o.messageId = null
        }
        return true
    }

    // 获取一封信件的信封信息
    async fetchMailEnvelope(uid: number | string): Promise<Envelope | false | null> {
        let envelope: Envelope | null = null
        let that = this
        let r = await this.generalCmd(["UID FETCH " + uid + " (UID FLAGS RFC822.SIZE ENVELOPE)"], {
            callbackForUntag: (tokens: ResponseToken[]) => {
                that._checkMaybeHaveNewMail(tokens)
                if (tokens.length < 4) {
                    return
                }
                if (tokens[2].value.toString().toUpperCase() != "FETCH") {
                    return
                }
                let sn: number = myParseInt(tokens[1].value.toString())
                //
                tokens = tokens[3].children
                if (tokens.length < 8) {
                    return
                }
                let uid = myParseInt(tokens[1].value.toString())
                let o: Envelope = {
                    uid,
                    size: myParseInt(tokens[5].value.toString()),
                    flags: that._decode_mail_flags(tokens[3].children),
                } as any
                if (!that._parse_envelope(o, tokens[7].children)) {
                    return
                }
                envelope = o
            },
        })
        if (r === null) {
            return null
        }
        return envelope || false
    }

    private _parseBodystructure_inner(tokens: ResponseToken[], parent: MimeNode | null): MimeNode | null {
        let that = this
        if (tokens.length < 1) {
            return null
        }
        let structure: MimeNode = {
            type: "",
            subtype: "",
            charset: "",
            encoding: "",
            size: -1,
            name: Buffer.allocUnsafe(0),
            filename: Buffer.allocUnsafe(0),
            nameUtf8: "",
            filenameUtf8: "",
            contentId: "",
            disposition: "",
            section: "",
            parent,
            children: []
        }
        if (tokens[0].children.length) {
            structure.type = "MULTIPART"
            for (let i = 0; i < tokens.length; i++) {
                if (tokens[i].children.length) {
                    let s = that._parseBodystructure_inner(tokens[i].children, structure)
                    if (s) {
                        structure.children.push(s)
                    }
                    continue
                }
                if (i < tokens.length) {
                    structure.subtype = tokens[i].value.toString().toUpperCase()
                } else {
                    structure.subtype = "MIXED"
                }
                break
            }
            return structure
        }
        if (tokens.length < 7) {
            return null
        }
        function name_filename(tokens: ResponseToken[]) {
            for (let i = 0; i < tokens.length; i += 2) {
                if (i + 1 == tokens.length) {
                    return
                }
                let key = tokens[i].value.toString().toLowerCase()
                let value = tokens[i + 1].value
                if (key == "name") {
                    structure.name = value
                    structure.nameUtf8 = decodeParamValueToString(value)
                } else if (key == "filename") {
                    structure.filename = value
                    structure.filenameUtf8 = decodeParamValueToString(value)
                } else if (key == "charset") {
                    structure.charset = value.toString().toUpperCase()
                }
            }
        }
        structure.type = tokens[0].value.toString().toUpperCase()
        structure.subtype = tokens[1].value.toString().toUpperCase()
        name_filename(tokens[2].children)
        structure.contentId = (that.isNIL(tokens[3]) ? "" : tokens[3].value.toString())
        structure.encoding = tokens[5].value.toString().toUpperCase()
        structure.size = myParseInt(tokens[6].value.toString())
        if (tokens.length > 8) {
            if (tokens[8].children.length) {
                structure.disposition = tokens[8].children[0].value.toString().toUpperCase()
            }
            if (tokens[8].children.length > 1) {
                name_filename(tokens[8].children[1].children)
            }
        }
        if (structure.type == "MESSAGE" && structure.subtype == "RFC822") {
            if (tokens[7].children.length > 1) {
                if (structure.name.length == 0) {
                    structure.name = tokens[7].children[1].value
                    structure.nameUtf8 = decodeValueToString(structure.name)
                }
            }
        }
        return structure
    }

    private _parseBodystructure_section(bs: MimeNode) {
        function compute_section(node: MimeNode, parentSection: string, idx: number) {
            let ns = parentSection.split(".")
            if (ns[ns.length - 1] == "0") {
                ns.pop()
            }
            ns.push("" + (idx + 1))
            node.section = ns.join(".")
            for (let i = 0; i < node.children.length; i++) {
                compute_section(node.children[i], node.section, i)
            }
        }
        bs.section = "0"
        for (let i = 0; i < bs.children.length; i++) {
            compute_section(bs.children[i], "0", i)
        }
        if (bs.children.length == 0) {
            bs.section = "1"
        }
    }

    private _parseBodystructure_classify(bs: BodyStructure, node: MimeNode) {
        function _walk_all_node(node: MimeNode) {
            let type = node.type
            let subtype = node.subtype
            if (type == "MULTIPART") {
                if (node.children) {
                    node.children.forEach(n => {
                        _walk_all_node(n)
                    })
                }
                return
            }
            if (type == "APPLICATION") {
                bs.attachmentMimes.push(node)
                return
            }
            if (node.disposition == "ATTACHMENT") {
                bs.attachmentMimes.push(node)
                return
            }
            if (type == "MESSAGE") {
                if (subtype.indexOf("DELIVERY") > 0 || subtype.indexOf("NOTIFICATION") > 0) {
                    bs.textMimes.push(node)
                    bs.showMimes.push(node)
                } else {
                    bs.attachmentMimes.push(node)
                }
                return
            }
            if (type == 'TEXT') {
                if (subtype == "HTML" || subtype == "PLAIN") {
                    bs.textMimes.push(node)
                } else {
                    bs.attachmentMimes.push(node)
                }
                return
            }
        }
        _walk_all_node(node)
    }

    private _parseBodystructure_show(bs: BodyStructure) {
        let alts: any = {}
        bs.textMimes.forEach(node => {
            if (node.type != "TEXT") {
                return
            }
            let parent: MimeNode | null = node
            while (parent) {
                if (parent.type != "MULTIPART" || parent.subtype != "ALTERNATIVE") {
                    parent = parent.parent
                    continue
                }
                break
            }
            if (!parent) {
                bs.showMimes.push(node)
                return
            }
            if (!alts[parent.section]) {
                alts[parent.section] = {}
            }
            alts[parent.section][node.subtype] = node
        })
        Object.keys(alts).forEach(k => {
            let alt = alts[k]
            if (alt.HTML) {
                bs.showMimes.push(alt.HTML)
            } else if (alt.PLAIN) {
                bs.showMimes.push(alt.PLAIN)
            }
        })
    }

    private _parseBodystructure_sort_mimes(bs: BodyStructure) {
        function _sort(a: MimeNode, b: MimeNode) {
            let aaa = a.section.split(".")
            let bbb = b.section.split(".")
            let ccc = aaa.length
            if (bbb.length < ccc) {
                ccc = bbb.length
            }
            for (let i = 0; i < ccc; i++) {
                let c = myParseInt(aaa[i]) - myParseInt(bbb[i])
                if (c < 0) {
                    return -1
                } else if (c > 0) {
                    return 1
                }
            }
            return aaa.length - bbb.length
        }
        bs.textMimes.sort(_sort)
        bs.showMimes.sort(_sort)
        bs.attachmentMimes.sort(_sort)
    }

    parseBodystructure(tokens: ResponseToken[]): BodyStructure | null {
        let topMime = this._parseBodystructure_inner(tokens, null)
        if (!topMime) {
            return null
        }

        let bs: BodyStructure = {
            textMimes: [],
            showMimes: [],
            attachmentMimes: [],
            topMime,
        }

        this._parseBodystructure_section(bs.topMime)
        this._parseBodystructure_classify(bs, bs.topMime)
        this._parseBodystructure_show(bs)
        this._parseBodystructure_sort_mimes(bs)
        return bs
    }

    // 获取 bodystructure
    async fetchMailStructure(uid: number | string): Promise<BodyStructure | false | null> {
        let bs: BodyStructure | null = null
        let that = this
        let r = await this.generalCmd(["UID FETCH" + " " + uid + " (UID BODYSTRUCTURE)"], {
            callbackForUntag: (tokens: ResponseToken[]) => {
                that._checkMaybeHaveNewMail(tokens)
                if (tokens.length < 4) {
                    return
                }
                if (tokens[2].value.toString().toUpperCase() != "FETCH") {
                    return
                }
                tokens = tokens[3].children
                if (tokens.length < 4) {
                    // return
                }
                let o = that.parseBodystructure(tokens[3].children)
                if (o) {
                    bs = o
                }
            },
        })
        if (r === null) {
            return null
        }
        return bs || false
    }

    // 获取一封邮件的基本信息(信封 + 结构)
    async fetchMailInfo(uid: number | string): Promise<MailInfo | false | null> {
        let mi: MailInfo | null = null
        let that = this
        let r = await this.generalCmd(["UID FETCH " + uid + " (UID FLAGS RFC822.SIZE ENVELOPE BODYSTRUCTURE)"], {
            callbackForUntag: (tokens: ResponseToken[]) => {
                that._checkMaybeHaveNewMail(tokens)
                if (tokens.length < 4) {
                    return
                }
                if (tokens[2].value.toString().toUpperCase() != "FETCH") {
                    return
                }
                let sn: number = myParseInt(tokens[1].value.toString())
                //
                tokens = tokens[3].children
                if (tokens.length < 10) {
                    return
                }
                let uid = myParseInt(tokens[1].value.toString())
                let o: MailInfo = {
                    uid,
                    size: myParseInt(tokens[5].value.toString()),
                    flags: that._decode_mail_flags(tokens[3].children),
                } as any
                if (!that._parse_envelope(o, tokens[7].children)) {
                    return
                }
                let bs = that.parseBodystructure(tokens[9].children)
                if (!bs) {
                    return
                }
                Object.keys(bs).forEach((k: string) => {
                    (o as any)[k] = (bs as any)[k]
                })
                mi = o
            },
        })
        if (r === null) {
            return null
        }
        return mi || false
    }

    // 获取信件部分数据
    async fetchMailDataByKey(key: string,
        uid: number | string,
        callbackForMailPieceData: (pieceData: Buffer) => Promise<boolean>,
        options?: {
            partial?: {
                offset: number,
                length: number,
            },
            callbackForFlags?: (flags: MailFlags) => any,
        }): Promise<boolean | null> {
        let that = this
        let tag_id = "" + (that.tag_id++);
        let cmd = tag_id + " UID FETCH " + uid + " (UID " + ((options && options.callbackForFlags) ? "FLAGS " : "") + key
        if (options && options.partial) {
            cmd += '<' + myParseInt(options.partial.offset) + "." + myParseInt(options.partial.length) + ">"
        }
        cmd += ")"
        await that.socket.write(cmd + "\r\n")
        if (that.debugMode) {
            console.log("imap write:", cmd)
        }
        if (that.readWriteRecorder) {
            that.readWriteRecorder("write", Buffer.from(cmd))
        }

        async function maybeReadExtra(left: number) {
            if (left < 0) {
                return true
            }
            while (left > 0) {
                let rlen = (left > 4096) ? 4096 : left
                const data = await that.socket.readn(rlen)
                if (data === null) {
                    return null
                }
                left -= data.length
            }
            if (await that.readTokens() === null) {
                return null
            }
            return true
        }

        while (1) {
            const lineResult = await that.complexReadOneLineTokens()
            if (lineResult === null) {
                return null
            }
            const tokens = lineResult.tokens
            if (tokens.length < 1) {
                continue
            }
            let token = tokens[0].value.toString()
            let extraDataLength = lineResult.extraDataLength
            if (token != "*") {
                if (!await maybeReadExtra(extraDataLength)) {
                    return false
                }
                if (token != tag_id) {
                    continue
                }
                if (!that.parseResult(tokens)) {
                    return null
                }
                return true
            }
            if (tokens.length > 2) {
                that._checkMaybeHaveNewMail(tokens)
            }
            let isFetch = false
            if (tokens.length > 3) {
                that._checkMaybeHaveNewMail(tokens)
                if ((tokens[2].value.toString().toUpperCase() == "FETCH") && (tokens[3].children.length > 2)) {
                    isFetch = true
                }
            }
            if (isFetch) {
                if (options && options.callbackForFlags) {
                    if (tokens[3].children.length > 3) {
                        options.callbackForFlags(that._decode_mail_flags(tokens[3].children[3].children))
                    }
                }
                if (extraDataLength < 0) {
                    await callbackForMailPieceData(tokens[3].children[tokens[3].children.length - 1].value)
                    if (await that.readTokens() === null) {
                        return null
                    }
                    continue
                }

                let left = extraDataLength
                while (left > 0) {
                    let rlen = (left > 4096) ? 4096 : left
                    const data = await that.socket.readn(rlen)
                    if (data === null) {
                        return null
                    }
                    left -= data.length
                    await callbackForMailPieceData(data)
                }
                if (await that.readTokens() === null) {
                    return null
                }
            } else {
                if (!await maybeReadExtra(extraDataLength)) {
                    return false
                }
            }
            continue
        }
        return true
    }

    // 获取邮件信体
    async fetchMailData(uid: number | string,
        callbackForMailPieceData: { (pieceData: Buffer): Promise<boolean> },
        options?: {
            partial?: {
                offset: number,
                length: number,
            },
            callbackForFlags?: (flags: MailFlags) => any,
        }): Promise<boolean | null> {
        return this.fetchMailDataByKey("BODY.PEEK[]", uid, callbackForMailPieceData, options)
    }

    // 获取邮件头
    async fetchMailHeader(uid: number | string,
        callbackForMailPieceData: { (pieceData: Buffer): Promise<boolean> },
        options?: {
            partial?: {
                offset: number,
                length: number,
            },
            callbackForFlags?: (flags: MailFlags) => any,
        }): Promise<boolean | null> {
        return this.fetchMailDataByKey("BODY.PEEK[HEADER]", uid, callbackForMailPieceData, options)
    }

    // 按section获取邮件信体
    async fetchMimeDataBySection(uid: number | string,
        section: string,
        callbackForMailPieceData: { (pieceData: Buffer): Promise<boolean> },
        options?: {
            partial?: {
                offset: number,
                length: number,
            },
        }): Promise<boolean | null> {
        return this.fetchMailDataByKey("BODY.PEEK[" + section + "]", uid, callbackForMailPieceData, options)
    }

    // 获取邮件头
    async fetchMimeHeaderBySection(uid: number | string,
        section: string,
        callbackForMailPieceData: { (pieceData: Buffer): Promise<boolean> },
        options?: {
            partial?: {
                offset: number,
                length: number,
            },
            isRfc822?: boolean,
        }): Promise<boolean | null> {
        let key = "MIME"
        if (options && options.isRfc822) {
            key = "HEADER"
        }
        return this.fetchMailDataByKey("BODY.PEEK[" + section + "." + key + "]", uid, callbackForMailPieceData, options)
    }
}

export default {
    utf8ToImapUtf7,
    imapUtf7ToUtf8,
    imapSyncClient,
}