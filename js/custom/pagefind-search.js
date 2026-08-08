/**
 * Pagefind 版本地搜索（替换 Butterfly 自带 local-search.js）
 * 数据源：构建时由 pagefind 生成的 /pagefind/ 静态索引，按查询分块加载，不再整包下载 search.xml。
 * DOM/CSS 复用主题结构（#local-search / .search-result-list 等），交互行为与原版一致。
 * 通过 _config.butterfly.yml 的 CDN.option.local_search 注入，主题升级不受影响。
 */
window.addEventListener('load', () => {
  const { languages, preload } = GLOBAL_CONFIG.localSearch

  const $input = document.querySelector('.local-search-input input')
  const $statsItem = document.getElementById('local-search-stats')
  const $loadingStatus = document.getElementById('loading-status')
  const $searchMask = document.getElementById('search-mask')
  const $searchDialog = document.querySelector('#local-search .search-dialog')
  const $results = document.getElementById('local-search-results')

  let pagefind = null
  let initError = false

  const initPagefind = async () => {
    if (pagefind || initError) return
    try {
      pagefind = await import('/pagefind/pagefind.js')
      await pagefind.init()
    } catch (e) {
      // 本地预览未跑 pagefind 构建时会走到这里
      console.error('Pagefind 索引加载失败（请先运行 npm run build）:', e)
      initError = true
    }
    window.dispatchEvent(new Event('search:loaded'))
  }

  const escapeHtml = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

  // pagefind 摘要自带 <mark>，套上主题高亮样式
  const styleExcerpt = excerpt => excerpt.replace(/<mark>/g, '<mark class="search-keyword">')

  const clearSearchResults = () => {
    $results.textContent = ''
    $statsItem.textContent = ''
  }

  const showNoResults = searchText => {
    $results.textContent = ''
    $statsItem.innerHTML = `<div class="search-result-stats">${languages.hits_empty.replace(/\$\{query}/, escapeHtml(searchText))}</div>`
  }

  const renderResults = (searchText, items) => {
    const list = items.map((r, i) => {
      const url = new URL(r.url, location.origin)
      url.searchParams.append('highlight', searchText)
      return `<li class="local-search-hit-item" value="${i + 1}"><a href="${url.href}"><span class="search-result-title">${escapeHtml(r.title)}</span><p class="search-result">${styleExcerpt(r.excerpt)}...</p></a></li>`
    }).join('')
    $results.innerHTML = `<ol class="search-result-list">${list}</ol>`
    $statsItem.innerHTML = `<hr><div class="search-result-stats">${languages.hits_stats.replace(/\$\{hits}/, items.length)}</div>`
    window.pjax && window.pjax.refresh($results)
  }

  // 防止慢查询覆盖新查询结果
  let searchSeq = 0

  const doSearch = async () => {
    const searchText = $input.value.trim()
    if (!searchText) {
      clearSearchResults()
      return
    }
    if (!pagefind) {
      showNoResults(searchText)
      return
    }
    const seq = ++searchSeq
    $loadingStatus.hidden = false
    try {
      const search = await pagefind.search(searchText)
      if (seq !== searchSeq) return
      const items = await Promise.all(search.results.slice(0, 20).map(async r => {
        const data = await r.data()
        return { url: data.url, title: (data.meta && data.meta.title) || data.url, excerpt: data.excerpt || '' }
      }))
      if (seq !== searchSeq) return
      items.length === 0 ? showNoResults(searchText) : renderResults(searchText, items)
    } finally {
      if (seq === searchSeq) $loadingStatus.hidden = true
    }
  }

  let searchTimeout
  const debouncedSearch = () => {
    clearTimeout(searchTimeout)
    if (!$input.value.trim()) {
      doSearch()
      return
    }
    searchTimeout = setTimeout(doSearch, 200)
  }

  const fixSafariHeight = () => {
    if (window.innerWidth < 768) {
      $searchDialog.style.setProperty('--search-height', window.innerHeight + 'px')
    }
  }

  let resizeTimer
  const onResize = () => {
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(fixSafariHeight, 150)
  }

  const handleEscape = event => {
    if (event.code === 'Escape') {
      closeSearch()
      document.removeEventListener('keydown', handleEscape)
    }
  }

  let loadFlag = false

  const openSearch = () => {
    btf.overflowPaddingR.add()
    btf.animateIn($searchMask, 'to_show 0.5s')
    btf.animateIn($searchDialog, 'titleScale 0.5s')
    setTimeout(() => { $input.focus() }, 300)
    if (!loadFlag) {
      initPagefind()
      $input.addEventListener('input', debouncedSearch)
      loadFlag = true
    }
    document.addEventListener('keydown', handleEscape)
    fixSafariHeight()
    window.addEventListener('resize', onResize)
  }

  const closeSearch = () => {
    btf.overflowPaddingR.remove()
    btf.animateOut($searchDialog, 'search_close .5s')
    btf.animateOut($searchMask, 'to_hide 0.5s')
    document.removeEventListener('keydown', handleEscape)
    window.removeEventListener('resize', onResize)
  }

  const searchClickFn = () => {
    btf.addEventListenerPjax(document.querySelector('#search-button > .search'), 'click', openSearch)
  }

  // 文章内关键词高亮（搜索结果链接带 ?highlight= 参数）
  const highlightSearchWords = body => {
    const params = new URL(location.href).searchParams.get('highlight')
    const keywords = params ? params.trim().split(/\s+/).filter(Boolean) : []
    if (!keywords.length || !body) return
    const walk = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null)
    const targets = []
    while (walk.nextNode()) {
      if (!walk.currentNode.parentNode.matches('button, select, textarea, code, pre, .mermaid')) targets.push(walk.currentNode)
    }
    targets.forEach(node => {
      const text = node.nodeValue
      const lower = text.toLowerCase()
      const hits = []
      keywords.forEach(word => {
        const w = word.toLowerCase()
        let pos = lower.indexOf(w)
        while (pos > -1) {
          hits.push({ position: pos, length: w.length })
          pos = lower.indexOf(w, pos + w.length)
        }
      })
      if (!hits.length) return
      hits.sort((a, b) => a.position - b.position)
      let index = 0
      const frag = document.createDocumentFragment()
      hits.forEach(({ position, length }) => {
        if (position < index) return
        frag.appendChild(document.createTextNode(text.substring(index, position)))
        const mark = document.createElement('mark')
        mark.className = 'search-keyword'
        mark.appendChild(document.createTextNode(text.substring(position, position + length)))
        frag.appendChild(mark)
        index = position + length
      })
      frag.appendChild(document.createTextNode(text.substring(index)))
      node.parentNode.replaceChild(frag, node)
    })
  }

  document.querySelector('#local-search .search-close-button').addEventListener('click', closeSearch)
  $searchMask.addEventListener('click', closeSearch)
  if (preload) initPagefind()
  highlightSearchWords(document.getElementById('article-container'))
  searchClickFn()

  window.addEventListener('search:loaded', () => {
    const $loadDataItem = document.getElementById('loading-database')
    if (!$loadDataItem) return
    $loadDataItem.nextElementSibling.style.visibility = 'visible'
    $loadDataItem.remove()
  })

  window.addEventListener('pjax:complete', () => {
    !btf.isHidden($searchMask) && closeSearch()
    highlightSearchWords(document.getElementById('article-container'))
    searchClickFn()
  })
})
