'use strict'
const fs = require('fs')
// const path = require('path')
const loadConfig = require('./config')
const util = require('./util')
const cache = require('./cache')
const parser = require('./parser')
const version = require('../package.json').version
const builder = require('./builder')

function escape (x) {
  return x
}

// function noext (str) {
//   return str.replace(/\.\w+$/, '')
// }

function loadFile (p, throwErr = true) {
  if (/\.wxss$/.test(p)) throwErr = false
  return new Promise((resolve, reject) => {
    fs.stat(`./${p}`, (err, stats) => {
      if (err) {
        if (throwErr) return reject(new Error(`file ${p} not found`))
        return resolve('')
      }
      if (stats && stats.isFile()) {
        let content = cache.get(p)
        if (content) {
          return resolve(content)
        } else {
          return parser(`${p}`).then(resolve, reject)
        }
      } else {
        return resolve('')
      }
    })
  })
}

exports.getIndex = async function () {
  let [config, rootFn] = await Promise.all([
    loadConfig(),
    util.loadTemplate('index')
  ])
  let pageConfig = await util.loadJSONfiles(config.pages)
  // 在配置项config的属性window的属性上挂载 页面配置
  config['window'].pages = pageConfig


  let tabBar = config.tabBar || {}
  let topBar = tabBar.position == 'top'

  //rootFn使用传入的参数，来填充index.html模板,返回的仍然是index.html字符串
  // 该函数拥有类似结构function (data, [filters], [escape])：参考https://www.npmjs.com/package/et-improve
  return rootFn(
    {
      config: JSON.stringify(config),
      root: config.root,
      // ip: util.getIp(),
      topBar: topBar,
      tabbarList: tabBar.list,
      tabStyle:
        `background-color: ${tabBar.backgroundColor}; border-color: ${tabBar.borderStyle}; height: ` +
        (topBar ? 47 : 56) +
        'px;',
      tabLabelColor: tabBar.color,
      tabLabelSelectedColor: tabBar.selectedColor,
      version
    },
    {},
    escape
  )
}

exports.getServiceJs = async function () {
  return builder.load()
}

exports.getPage = async function (path) {
  return Promise.all([
    loadFile(path + '.wxml'),
    loadFile(path + '.wxss'),
    builder.buildPage(path + '.js')
  ])
}

exports.getAppWxss = async function (path) {
  return loadFile(path + '.wxss')
}
