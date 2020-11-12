const growl = require('growl')
const path = require('path')
const chalk = require('chalk')
const et = require('et-improve') // 一款模板引擎
const fs = require('fs-extra')
const glob = require('glob')
const Parallel = require('node-parallel')
const babel = require('babel-core')
const isWin = /^win/.test(process.platform)
const Concat = require('concat-with-sourcemaps') // 将 files和sourceMaps映射起来
const UglifyJS = require('uglify-js')
const ni = require('os').networkInterfaces()

const BASE_DEVICE_WIDTH = 750
const EPS = 0.0001
const RPXRE = /%%\?[+-]?\d+(\.\d+)?rpx\?%%/g

function normalizePath (p) {
  if (isWin) return p.replace(/\\/g, '/')
  return p
}
exports.normalizePath = normalizePath

// 获取项目中所有的js文件路径构成的数组
exports.globJSfiles = function () {
  return new Promise(function (resolve, reject) {
    // glob 利用模式匹配 找出符合要求的文件数组(此处是找到项目根目录下及里面，所有的js文件:结果就是dist中的所有Jsw文件)
    glob(
      '**/*.js',
      {
        ignore: ['node_modules/**/*.js', 'heraTmp', 'wewebTmp', 'tmp']
      },
      function (err, files) {
        if (err) return reject(err)
        resolve(files)
      }
    )
  })
}

exports.loadJSONfiles = function (pages) {
  let p = new Parallel()
  let res = {}
  return new Promise((resolve, reject) => {
    for (let page of pages) {
      let file = page + '.json'
      p.add(cb => {
        fs.stat(file, function (err, stat) {
          if (err) reject(err)
          if (stat && stat.isFile()) {
            fs.readFile(file, 'utf8', (err, content) => {
              if (err) return cb()
              try {
                res[page] = JSON.parse(content)
              } catch (e) {
                return cb(new Error(`${file} JSON 解析失败，请检查`))
              }
              cb()
            })
          } else {
            return cb()
          }
        })
      })
    }
    p.done(err => {
      if (err) return reject(err)
      resolve(res)
    })
  })
}

let id = 1
exports.uid = function () {
  return id++
}

exports.exists = function (p) {
  return new Promise(function (resolve, reject) {
    fs.stat(p, function (err, stats) {
      if (err) return resolve(false)
      if (stats.isFile() || stats.isDirectory()) {
        return resolve(true)
      }
      resolve(false)
    })
  })
}

exports.readFile = function (p) {
  return new Promise(function (resolve, reject) {
    fs.readFile(p, 'utf8', function (err, content) {
      if (err) reject(err)
      resolve(content)
    })
  })
}

// 解析wxml，获取该页面上所有引入文件的路径
// From: <import src="../../../common/head.wxml" />
// To: 'page/common/head.wxml'


exports.parseImports = function parseImports (res, file, cb) {
  fs.readFile(file, 'utf8', (err, xml) => {
    if (err) return cb(err)
    // 写出 检测通过import/include方式引入外部文件 的正则表达式
    let re = /<(import|include)\s+[^>]+?>/g
    let arr = []
    let p = new Parallel()

    // 正则表达式 .exec()会持续自动往后走执行吗?
    while ((arr = re.exec(xml)) !== null) {
      //arr[0] 就是引入外部文件的那行代码
      let ms = arr[0].match(/src=(['"])([^\1]+)\1/)
      if (ms && ms[2]) {
        let f = /^\//.test(ms[2])
          ? ms[2].replace(/^\//, '')
          : path.join(path.dirname(file), ms[2])
        f = /\.wxml/.test(f) ? f : `${f}.wxml`
        f = normalizePath(f)
        if (res.indexOf(f) == -1) {
          res.push(f)
          p.add(done => {
            parseImports(res, f, done)
          })
        }
      }
    }
    p.done(cb)
  })
}


exports.parseCssImports = function parseCssImports (res, file, cb) {
  let re = /\s*@import\s+[^;]+?;/g
  fs.readFile(file, 'utf8', (err, content) => {
    if (err) return cb(err)
    let arr = []
    let p = new Parallel()
    content = content.replace(/\/\*[\s\S]*?\*\//g, '')
    while ((arr = re.exec(content)) !== null) {
      let ms = arr[0].match(/(['"])([^\1]+)\1/)
      if (ms && ms[2]) {
        let f = /^\//.test(ms[2])
          ? ms[2].replace(/^\//, '')
          : path.join(path.dirname(file), ms[2])
        f = normalizePath(f)
        if (res.indexOf(f) == -1) {
          res.push(f)
          p.add(done => {
            parseCssImports(res, f, done)
          })
        }
      }
    }
    p.done(cb)
  })
}

exports.loadTemplate = function (name) {
  return new Promise(function (resolve, reject) {
    fs.readFile(
      path.resolve(__dirname, `./template/${name}.html`),
      'utf8',
      (err, content) => {
        if (err) return reject(err)
        try {
          // et.compile：使用传入的参数，将模板字符串编译成函数，该函数拥有类似结构function (data, [filters], [escape])
          resolve(et.compile(content))
        } catch (e) {
          console.error(e.stack)
          reject(e)
        }
      }
    )
  })
}

// 找到那些既不是app.js，也不是page.js的.js文件
exports.groupFiles = function (files, config) {
  // A- 此处是不是有问题？config中pages是挂载在window下面的。这里的写法没意义！
  let pages = config.pages.map(page => {
    return page + '.js'
  })
  let utils = [] //找到那些既不是app.js，也不隶属于page的.js文件，放入utils数组
  let routes = []
  files.forEach(function (file) {
    if (file !== 'app.js') {
      let index = pages.indexOf(file)
      if (index == -1) {
        utils.push(file)
      } else {
        pages.splice(index, 1)
      }
    }
  })

  // A - 这里应该是要打印出page中需要有的js，但实际没有的情况
  pages.length &&
    pages.forEach(function (page) {
      console.log(chalk.red(` ✗ ${page} not found`))
    })

  console.log(utils)
  return utils // 返回一些一般.js文件
}

exports.parseJavascript = function (config, full_path) {
  return new Promise(function (resolve, reject) {
    //加强校验而已：确保既不是app.js，也不是page隶属下的.js文件
    let isModule =
      full_path != 'app.js' &&
      config.pages.indexOf(full_path.replace(/\.js$/, '')) == -1

    loadJavascript(full_path, config.babel, function (err, result) {
      if (err) return reject(err)

      // 针对每个path对应的.js文件：初始化一个Concat对象，true表明需要生成sourceMap, 要生成的文件名/路径，分隔符
      let concat = new Concat(true, full_path, '\n')

      concat.add(null,`define("${full_path}", function(require, module, exports, window,document,frames,self,location,navigator,localStorage,history,Caches,screen,alert,confirm,prompt,fetch,XMLHttpRequest,WebSocket,webkit,WeixinJSCore,WeixinJSBridge,Reporter){`)
      concat.add(full_path, result.code, result.map)
      concat.add(null, '});' + (isModule ? '' : `require("${full_path}")`) + '\n')

      return resolve({
        code: concat.content,
        map: concat.sourceMap
      })
    })
  })
}

const inProd = process.env.NODE_ENV === 'production'

// 利用babel将full_path指定的js文件转码成 严格模式的es5
function loadJavascript (full_path, useBabel, cb) {
  if (useBabel && useBabel != '0') {
    // console.log('useBabel:true',useBabel)
    
    // 异步的文件转码：将ES6转为ES5，加 'use strict' 等
    babel.transformFile(
      full_path,
      {
        presets: ['babel-preset-env', 'babel-preset-stage-0'].map(
          require.resolve
        ),
        sourceMaps: !inProd,
        sourceRoot: process.cwd(),
        sourceFileName: full_path,
        babelrc: false,
        ast: false,
        resolveModuleSource: false
      },
      // 此处babel生成的result有code，sourceMap
      function (err, result) {
        if (err) return cb(err)

        // production环境下，则利用babel压缩代码
        if (inProd) {
          result.code = UglifyJS.minify(result.code, { fromString: true }).code
        }
        cb(null, result)
      }
    )
  } else {
    fs.readFile(full_path, 'utf8', function (err, content) {
      if (err) return cb(err)
      cb(null, {
        code: content,
        map: null
      })
    })
  }
}

exports.notifyError = function (err) {
  console.error(err.stack)
  let img = path.resolve(__dirname, './template/images/error.png')
  growl(err.message, {
    image: img
  })
}

exports.getIp = function () {
  let ipAddress = []
  for (let key in ni) {
    for (let index in ni[key]) {
      if (ni[key][index].family === 'IPv4' && !ni[key][index].internal) {
        ipAddress.push(ni[key][index].address)
      }
    }
  }
  if (ipAddress.length >= 1) {
    return ipAddress[0]
  } else {
    return '127.0.0.1'
  }
}

exports.parseCss = function (content, width, ratio) {
  var b
  b = content.match(RPXRE)
  if (b) {
    b.forEach(function (c) {
      var d = getNumber(c, width, ratio)
      var e = d + 'px'
      content = content.replace(c, e)
    })
  }
  return content
}
exports.mkdirsSync = function (dirname) {
  let self = this
  if (fs.existsSync(dirname)) {
    return true
  } else {
    if (self.mkdirsSync(path.dirname(dirname))) {
      fs.mkdirSync(dirname)
      return true
    }
  }
}
exports.rmEmptyDirsSync = function (dirname) {
  let self = this
  var paths = fs.readdirSync(dirname)
  // console.log(dirname,paths);
  if (!paths.length) {
    fs.rmdirSync(dirname)
    return true
  } else {
    var count = 0
    paths.forEach(function (p) {
      p = path.join(dirname, p)
      var stat = fs.statSync(p)
      if (stat.isDirectory()) {
        if (self.rmEmptyDirsSync(p)) {
          count++
        }
      }
    })
    if (paths.length === count) {
      fs.rmdirSync(dirname)
      return true
    }
  }
}

/**
 * [copy 复制文件到目标文件，递归调用]
 * @param  {[string]} src [原文件]
 * @param  {[string]} dst [目标文件]
 * @return {[type]}     [description]
 */
exports.copyDir = function (src, dst, callback, filter) {
  let self = this
  if (typeof callback === 'object' && !filter) {
    filter = callback
    callback = null
  }
  if (!filter) {
    filter = {}
  }
  // 读取目录中的所有文件/目录
  let paths = fs.readdirSync(src)
  if (paths && paths.length) {
    self.mkdirsSync(dst)
    paths.forEach(function (p) {
      var _src = src + '/' + p,
        _dst = dst + '/' + p
      // filter.filename && console.log(filter.filename,p,filter.filename.indexOf(p))
      if (filter.filename && filter.filename.indexOf(p) != -1) return
      let st = fs.statSync(_src)
      if (st) {
        // 判断是否为文件
        if (st.isFile()) {
          if (
            filter.extname &&
            filter.extname.indexOf(path.extname(_src)) != -1
          ) {
            return
          }
          // 通过管道来传输流
          fs.createReadStream(_src).pipe(fs.createWriteStream(_dst))
        } else if (st.isDirectory()) {
          // 如果是目录则递归调用自身
          self.copyDir(_src, _dst, null, filter)
        }
      }
    })
  }
  if (callback) {
    callback()
  }
}

exports.createFile = function (distPath, fileName, text, cb, noOutput) {
  if (!text || !distPath || !fileName) return
  let self = this
  fs.exists(distPath, function (exists) {
    if (!exists) {
      self.mkdirs(distPath)
    }
    fs.writeFile(path.join(distPath, fileName), text, function (err) {
      cb && cb()
      if (err) {
        throw err
      }
      if (!noOutput) {
        console.log(`Export ${fileName} Success!`)
      }
    })
  })
}
exports.createFilePromise = async function (distPath, fileName, text, noOutput) {
  if (!text || !distPath || !fileName) return
  let self = this
  const exists = await fs.exists(distPath)

  if (!exists) {
    self.mkdirs(distPath)
  }
  return fs.writeFile(path.join(distPath, fileName), text).then(res => {
    if (!noOutput) {
      console.log(`Export ${fileName} Success!`)
    }
  })
}

// 创建所有目录
exports.mkdirs = function (dirpath) {
  let self = this
  if (!fs.existsSync(dirpath)) {
    self.mkdirs(path.dirname(dirpath))
    fs.mkdirSync(dirpath)
  }
}

function transformByDPR (a, width, dpr) {
  a = a / BASE_DEVICE_WIDTH * width
  a = Math.floor(a + EPS)
  if (a === 0) {
    if (dpr === 1) {
      return 1
    } else {
      return 0.5
    }
  }
  return a
}

function getNumber (e, width, ratio) {
  var g = 0
  var d = 1
  var a = false
  var f = false
  for (var b = 0; b < e.length; ++b) {
    var h = e[b]
    if (h >= '0' && h <= '9') {
      if (a) {
        d *= 0.1
        g += (h - '0') * d
      } else {
        g = g * 10 + (h - '0')
      }
    } else {
      if (h === '.') {
        a = true
      } else {
        if (h === '-') {
          f = true
        }
      }
    }
  }
  if (f) {
    g = -g
  }
  return transformByDPR(g, width, ratio)
}

exports.copy = function (src, dest, opts) {
  opts = Object.assign(
    {},
    {
      exclude: {
        basename: [],
        extname: []
      }
    },
    opts
  )
  return fs.copy(src, dest, {
    filter: (src, dest) => {
      if (fs.lstatSync(src).isDirectory()) {
        return !~opts.exclude.basename.indexOf(path.basename(src))
      }
      return !~opts.exclude.extname.indexOf(path.extname(src))
    }
  })
}
