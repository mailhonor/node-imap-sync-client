// const imapSyncClient = require("imap-sync-sclient")
import { imapSyncClient, imapUtf7ToUtf8, utf8ToImapUtf7 } from "../dist/index.mjs"

const sleep = async (t) => {
    return new Promise((resolv) => {
        setTimeout(() => {
            resolv("")
        }, t)
    })
}


async function do_test(attrs) {
    console.log(attrs)

    // 创建对象
    let ic = new imapSyncClient({
        host: attrs.host,
        port: attrs.port,
        ssl: attrs.ssl,
        user: attrs.user,
        pass: attrs.pass,
        startTLS: attrs.startTLS
    })
    ic.setDebugMode()

    // open，包括 连接，STARTTLS，认证，ID，CAPABILITY 等
    if (!await ic.open()) {
        console.error("imap connect, error: ", ic.getLastReadedBuffer().toString())
        return
    }
    console.log("connect, success")


    // 在操作中, 试着检查是否有新的信件
    ic.setMaybeHaveNewMailHandler(() => {
        console.log("maybe have new mail")
    })

    // 通过命令 LIST，获取文件夹列表
    let mboxs = await ic.getMboxList()
    if (mboxs === null) {
        console.error("cmdList, error: ", ic.getLastReadedBuffer().toString())
        return
    }
    console.log("mboxs", mboxs)

    // 遍历文件夹列表，执行 STATUS 命令
    for (let i = 0; i < mboxs.length; i++) {
        let fo = mboxs[i]
        let mboxName = fo.mboxName
        if (!fo.attrs.noselect) {
            // STATUS 名
            let status = await ic.getMboxStatus(mboxName)
            if (status === null) {
                console.error("cmdStatus " + mboxName.toString() + ", error: ", ic.getLastReadedBuffer().toString())
                return
            }
            console.log("status " + mboxName.toString() + ", success:", status)
        }
    }
    //
    for (let i = 0; i < mboxs.length; i++) {
        let fo = mboxs[i]
        let mboxName = fo.mboxName
        console.log("mboxName:", mboxName.toString(), imapUtf7ToUtf8(mboxName), utf8ToImapUtf7(imapUtf7ToUtf8(mboxName)))
    }

    // 命令 SELECT， 选择 INBOX
    const selector = await ic.selectMbox("INBOX")
    if (selector === null) {
        console.error("cmdSelect INBOX, error: ", ic.getLastReadedBuffer().toString())
        return
    }
    console.log("select INBOX, success: ", selector)

    // 通过命令 FETCH， 获取当前文件夹（INBOX）下所有邮件的UID和其标记列表，
    let uidWithFlags = await ic.fetchUidListWithFlags()
    if (uidWithFlags === null) {
        console.error("fetchUidListWithFlags INBOX, error: ", ic.getLastReadedBuffer().toString())
        return
    }
    if (uidWithFlags.length < 2) {
        console.log("fetch uid list, success: ", uidWithFlags)
    } else {
        console.log("fetch uid list, success: ", uidWithFlags.slice(0, 2), uidWithFlags.length - 2, + " MORE")
    }

    // 通过命令 UID SEARCH，获取星标邮件UID列表
    let flaggedUids = await ic.searchFlaggedUids()

    if (flaggedUids === null) {
        console.error("searchAllUids INBOX, error: ", ic.getLastReadedBuffer().toString())
        return
    }
    console.log("searchFlaggedUids, success: ", flaggedUids)

    // 通过命令 UID SEARCH，获取所有邮件UID列表
    let allUids = await ic.searchAllUids()
    if (allUids === null) {
        console.error("searchAllUids INBOX, error: ", ic.getLastReadedBuffer().toString())
        return
    }
    console.log("searchAllUids, success: ", allUids)

    //下面几个是文件夹相关操作，顾名思义即可
    await ic.createMbox(utf8ToImapUtf7("你好啦啦啦"))
    await ic.subscribeMbox(utf8ToImapUtf7("你好啦啦啦"))
    await ic.createMbox("abc")
    await ic.subscribeMbox("abc")
    await ic.deleteMbox("abc")
    await ic.subscribeMbox("abc")
    await ic.unSubscribeMbox("abc")
    await ic.deleteMbox("abc")
    await ic.deleteMbox("ddd")
    await ic.deleteMbox("eee")
    await ic.renameMbox("abc", "ddd")
    await ic.createMbox("abc")
    await ic.renameMbox("abc", "ddd")
    await ic.renameMbox("abc", "eee")

    // 如果想测试新的信件检查:
    if (0) {
        // 等 10 秒
        console.log("等十秒, 期间, 请上传信件到收件箱")
        await sleep(10 * 1000)
        await ic.cmdNoop()
    }

    await ic.createMbox("abc")
    await ic.selectMbox("INBOX")

    // 通过命令APPEND, 上传信件到 文件夹 abc
    let msgbf = Buffer.from(attrs.appendMsg)
    await ic.appendMail("abc", msgbf.length, () => {
        return msgbf
    }, {
        callbackForAppendUid(r) {
            console.log("append mail, appenduid: ", r.uidvalidity, r.uid)
        }
    })

    // 获取 inbox 文件夹下, 一封信件的信封等信息
    await ic.selectMbox("inbox")
    let uids = await ic.searchAllUids()
    if (uids && uids.length) {
        let uid = uids[0]
        // 信封
        let envelope = await ic.fetchMailEnvelope(uid)
        console.log("envelope", envelope)
        // 结构
        let structure = await ic.fetchMailStructure(uid)
        console.log("structure", structure)
        // 信息(信封 + 结构)
        let mi = await ic.fetchMailInfo(uid)
        console.log("mailinfo", mi)

        // 获取第一个可读mime的数据
        if (mi.textMimes.length) {
            await ic.fetchMimeDataBySection(uid, mi.textMimes[0].section,
                async (pieceData) => {
                    console.log("part", pieceData.toString())
                },
                {
                    partial: {
                        offset: 0,
                        length: 128
                    }
                })
        }
        // 获取 信件
        await ic.fetchMailData(uid,
            async (pieceData) => {
                console.log("eml", pieceData.toString())
            },
            {
                partial: {
                    offset: 0,
                    length: 256
                },
                callbackForFlags: (flags) => {
                    console.log("flags", flags)
                }
            })
    }

    // logout
    await ic.logout()
}

// 程序开始

let argv = process.argv
if (argv.length < 6) {
    console.log("USAGE: " + argv[0] + " " + argv[1] + "host port user pass [ SSL / STARTTLS ]")
    console.log("examples");
    console.log(argv[0], argv[1], "127.0.0.1 143 x1@a.com password123")
    console.log(argv[0], argv[1], "127.0.0.1 143 x1@a.com password123 STARTTLS")
    console.log(argv[0], argv[1], "127.0.0.1 993 x1@a.com password123 SSL")
    process.exit(1)
}

// 准备对象的参数
let attrs = {}
attrs.host = argv[2]
attrs.port = parseInt(argv[3])
attrs.user = argv[4]
attrs.pass = argv[5]

if (argv[6] === "SSL") {
    attrs.ssl = true
} else if (argv[6] === "STARTTLS") {
    attrs.startTLS = true
}

// 准备一封信,用于上传测试 
let msgs = []
msgs.push("Subject: imap-sync-client append cmd, " + (new Date()).getTime() + "\r\n")
msgs.push("From: nihao@linuxmail.cn\r\n")
msgs.push("to: thanks@linuxmail.cn\r\n")
msgs.push("Message-Id: message_id_random_string_" + (new Date()).getTime() + "\r\n")
msgs.push("Content-Type: text/plain; charset=utf-8\r\n")
msgs.push("Content-Transfer-Encoding: 8bit\r\n")
msgs.push("\r\n")
msgs.push("\r\n")
msgs.push("imap-sync-client 邮件上传测试\r\n")
msgs.push("\r\n")
attrs.appendMsg = msgs.join("")

// 测试开始
do_test(attrs).then(() => {
    console.log("\ntest over\n")
})