const { SerialPort } = require('serialport')
const { ReadlineParser } = require('@serialport/parser-readline')

// 串口参数 COM1 115200 8N1
const port = new SerialPort({
  path: 'COM1',
  baudRate: 115200,
  dataBits: 8,
  stopBits: 1,
  parity: 'none',
  flowControl: 'none'
})
const parser = port.pipe(new ReadlineParser({ delimiter: '\r\n' }))
let recvBuffer = []
let timerTask = null
let serialnumber = 0
// 自定义发送报文
const sendContent = "$GNRMC,080134.00,A,4002.54143,N,11619.54735,E,0.064,,010726,,,A,V*15\r\n"
// const sendContent = "$GNRMC,103417.00,A,4002.51700,N,11619.52994,E,0.262,,270526,,,A,V*0C\r\n"
const sendHeart = '{"cmd":"heart","type":"ld100","id":"002026063001","sn":'
// 打印DTU AT应答
parser.on('data', async (line) => {
  console.log('【收到DTU的消息】', line)
  recvBuffer.push(line)
  //【新增逻辑：收到带msgId控制指令自动回复成功应答】
  await sleep(1000)
  try {
    const data = JSON.parse(line.trim())
    if (data.msgId) {
      const reply = JSON.stringify({
        cmd: data.cmd,
        msgId: data.msgId,
        code: 1
      }) + '\r\n'
      sendCustomMsg(reply)
      console.log('【延迟1s,自动应答下发成功回执】', reply.trim())
    }
  } catch (parseErr) {
    // AT指令、GPS字符串、心跳等非合法控制JSON，不自动回复
  }
})

// 打印原始串口数据
port.on('data', (raw) => {
  // console.log('【原始字节hex】', raw.toString('hex'))
  // console.log('【原始字符串】', raw.toString('utf8'))
})

function sleep(ms) {
  return new Promise(resolveTimer => setTimeout(resolveTimer, ms))
}

// DTU初始化配置（纯TCP透传）
async function initDTU() {
  await sleep(2000)
  console.log('==== DTU初始化：TCP透传模式 ====')
  const cmdList = [
    // 测试串口AT通道是否正常，返回OK代表串口AT功能可用
    "usr.cn#AT",
    // 关闭串口无数据自动重启，0=永久关闭，解决模块提示通讯超时复位告警
    "usr.cn#AT+RSTIM=0",
    // 配置串口参数：波特率115200，8数据位，1停止位，无校验，无硬件流控
    "usr.cn#AT+UART=115200,8,1,NONE,NONE",
    // 串口缓存打包阈值：缓存达到1024字节时立即打包发送TCP
    "usr.cn#AT+UARTFL=1024",
    // 串口打包超时：等待50ms无新数据，强制发送缓存内数据
    "usr.cn#AT+UARTFT=50",
    // 开启AT指令回显，下发指令模块原样返回，方便调试查看下发内容
    "usr.cn#AT+E=ON",
    // 设置串口AT访问密码前缀为usr.cn#，透传模式下发AT必须携带此前缀
    "usr.cn#AT+CMDPW=usr.cn#",
    // 开启透传模式下串口AT功能，关闭后NET模式无法下发任何AT配置指令
    "usr.cn#AT+UATEN=ON",
    // 开启NAT内网保活，4G移动网络下维持长连接，避免运营商主动断链
    "usr.cn#AT+NATEN=ON",
    // 4G移动APN配置：CMNET移动公网，无账号密码，0=自动拨号联网
    "usr.cn#AT+APN=CMNET,,0",
    // 配置TCP主通道A：TCP客户端，连接服务器IP 123.57.87.144 端口60000
    "usr.cn#AT+SOCKA=TCP,123.57.87.144,60000",
    // 启用TCP A通道，模块上电主动连接配置的服务器
    "usr.cn#AT+SOCKAEN=ON",
    // TCP长连接模式，断线后自动循环重连，不会单次连接断开后停止
    "usr.cn#AT+SOCKASL=LONG",
    // TCP保活参数(通道A)：开启保活；空闲60s发心跳；无响应15s重试；失败3次判定断线重连
    "usr.cn#AT+KEEPALIVEA=1,60,15,3",
    // 开启上电注册上报功能，联网后主动上报设备信息给服务端
    "usr.cn#AT+REGEN=ON",
    // 注册上报携带内容：设备SN序列号
    "usr.cn#AT+REGTP=SN",
    // 注册报文发送时机：TCP链路成功建立完成后上报SN
    "usr.cn#AT+REGSND=LINK",
    // 设置设备工作模式为NET网络透传：串口数据透明转发TCP，下行数据输出串口
    "usr.cn#AT+WKMOD=NET",
    // 保存全部配置到模块闪存，重启设备参数不丢失
    "usr.cn#AT+S"
  ]

  for (const cmd of cmdList) {
    console.log('【下发配置】', cmd)
    port.write(cmd + '\r\n')
    await sleep(1000)
  }
  console.log('==== 配置保存完成，等待DTU联网3秒 ====')
  await sleep(3000)
}

// 查询TCP通道A连接状态
async function checkTcpLink() {
  return new Promise((resolve) => {
    let result = null;
    // 清空上次缓存
    recvBuffer.length = 0;
    port.write('usr.cn#AT+SOCKALK\r\n');
    setTimeout(() => {
      // 遍历应答，查找连接状态
      for (const line of recvBuffer) {
        if (line.includes('Connected')) {
          result = true;
          break;
        }
        if (line.includes('Disconnect')) {
          result = false;
          break;
        }
      }
      resolve(result);
    }, 1000);
  })
}
// 打印TCP通道配置：服务器IP、端口、重连模式
async function printTcpServerInfo() {
  recvBuffer.length = 0;
  console.log("\n========== TCP服务端配置信息 ==========");
  port.write('usr.cn#AT+SOCKA?\r\n');
  await sleep(1000);

  let serverIp = "";
  let serverPort = "";
  for (const line of recvBuffer) {
    console.log("应答行：", line);
    if (line.startsWith("+SOCKA:")) {
      const arr = line.split(",");
      // arr[0] = +SOCKA:TCP
      serverIp = arr[1];
      serverPort = arr[2];
    }
  }
  console.log("--------------------------------------");
  console.log("TCP服务器IP：", serverIp);
  console.log("TCP端口号：", serverPort);
  console.log("======================================\n");
}
async function printDtuLocalIP() {
  recvBuffer.length = 0;
  console.log("\n========== DTU本机4G IP 查询流程 ==========");

  // 1. 切到CMD指令模式（需要密码前缀）
  port.write('usr.cn#AT+WKMOD=CMD\r\n');
  await sleep(1200);

  // 2. 查询4G IP：蜂窝指令 不加 usr.cn# 前缀！
  recvBuffer.length = 0;
  port.write('AT+CGPADDR\r\n');
  await sleep(1200);

  let dtuIp = "未获取到IP";
  for (const line of recvBuffer) {
    console.log("应答原始行：", JSON.stringify(line));
    if (line.includes("+CGPADDR:")) {
      const parts = line.split(":");
      dtuIp = parts.slice(1).join(":").trim();
    }
  }
  console.log("DTU蜂窝内网IP：", dtuIp);

  // 3. 切回NET透传模式（带前缀）
  recvBuffer.length = 0;
  port.write('usr.cn#AT+WKMOD=NET\r\n');
  await sleep(1000);

  // 4. 保存配置
  port.write('usr.cn#AT+S\r\n');
  await sleep(1000);

  console.log("===================================\n");
}
// 单次发送自定义报文（透传直发，无AT指令）
function sendCustomMsg(messge) {
  console.log('\n【30秒定时心跳通过DTU推送给TCP服务器】', messge.trim())
  port.write(messge)
}

port.on('open', async () => {
  console.log('COM1 串口打开成功，115200 8N1')
  // 1. 初始化DTU全部参数
  await initDTU()
  await sleep(9000)
  // 2. 检查TCP是否连接成功
  let tcpconnectedfalg = await checkTcpLink()
  if (tcpconnectedfalg) {
    console.log('tcp has connected!')
  } else {
    console.log('tcp is Disconnect???')
  }
  await printTcpServerInfo()
  await sleep(1000);
  // await printDtuLocalIP()
  // await sleep(1000);
  // 3. 立即先发一条
  // sendCustomMsg(sendContent)
  // 4. 启动30秒循环定时器
  timerTask = setInterval(() => {
    //sendCustomMsg(sendContent)
    
    serialnumber = serialnumber + 1
    if (serialnumber>65535) {
      serialnumber = 0
    }
    let sendSN = sendHeart
    sendSN = sendSN + serialnumber + '}\r\n'
    sendCustomMsg(sendSN)
  }, 30 * 1000)
})

port.on('error', (err) => {
  console.error('串口异常报错：', err.message)
  if (timerTask) clearInterval(timerTask)
})

// 进程退出时销毁定时器
process.on('SIGINT', () => {
  if (timerTask) clearInterval(timerTask)
  port.close()
  console.log('\n定时器已停止，串口关闭')
  process.exit()
})
