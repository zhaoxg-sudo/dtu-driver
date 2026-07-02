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

// 打印AT应答
parser.on('data', (line) => {
  console.log('【DTU应答】', line)
  recvBuffer.push(line)
})

// 打印原始收发数据
port.on('data', (raw) => {
  console.log('【原始字节hex】', raw.toString('hex'))
  console.log('【原始字符串】', raw.toString('utf8'))
})

function sleep(ms) {
  return new Promise(resolveTimer => setTimeout(resolveTimer, ms))
}

// 初始化DTU（不含任何自动定时心跳）
async function initDTU() {
  await sleep(2000)
  console.log('==== DTU基础初始化开始（无自动心跳）====')
  const cmdList = [
    "usr.cn#AT",
    "usr.cn#AT+RSTIM=0",
    "usr.cn#AT+UART=115200,8,1,NONE,NONE",
    "usr.cn#AT+UARTFL=1024",
    "usr.cn#AT+UARTFT=50",
    "usr.cn#AT+E=ON",
    "usr.cn#AT+CMDPW=usr.cn#",
    "usr.cn#AT+UATEN=ON",
    "usr.cn#AT+NATEN=ON",
    "usr.cn#AT+APN=CMNET,,0",
    "usr.cn#AT+SOCKA=TCP,123.57.87.144,60000",
    "usr.cn#AT+SOCKAEN=ON",
    "usr.cn#AT+SOCKASL=LONG",
    "usr.cn#AT+KEEPALIVEA=1,60,15,3",
    "usr.cn#AT+REGEN=ON",
    "usr.cn#AT+REGTP=SN",
    "usr.cn#AT+REGSND=LINK",
    "usr.cn#AT+WKMOD=NET",
    "usr.cn#AT+S"
  ]

  for (const cmd of cmdList) {
    console.log('【下发配置】', cmd)
    port.write(cmd + '\r\n')
    await sleep(1000)
  }
  console.log('==== 基础配置完成，无自动定时发送 ====')
}

// 手动推送单条自定义GNRMC消息（一次性触发，不开启循环定时）
async function sendOnceMsg() {
  const sendCmd = 'usr.cn#AT+SEND=test messge'
  console.log('\n【手动触发单次推送】', sendCmd)
  port.write(sendCmd + '\r\n')
  await sleep(1000)
  console.log('单次报文下发完成，DTU立即输出这条:test messge')
}

port.on('open', async () => {
  console.log('COM1 串口打开成功 115200 8N1')
  // 1. 先初始化DTU联网参数
  await initDTU()

  // 2. 执行一次手动推送，需要就保留，不需要注释掉
  await sleep(9000)
  await sendOnceMsg()
})

port.on('error', (err) => {
  console.error('串口错误：', err.message)
})
