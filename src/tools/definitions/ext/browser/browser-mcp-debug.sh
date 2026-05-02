#!/bin/bash
# browser-mcp-debug.sh - 基于 Chrome DevTools Protocol 的高级调试能力
# 提供网络监控、性能分析、内存检测等高级功能

set -e

# 参数解析
ACTION="${1:-network}"
URL="${2:-}"
OUTPUT_DIR="${3:-/tmp/browser-mcp-$(date +%s)}"
TIMEOUT="${TIMEOUT:-60000}"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
  echo -e "${GREEN}[INFO]${NC} $1"
}

log_debug() {
  echo -e "${BLUE}[DEBUG]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

# 检查依赖
check_dependencies() {
  if ! command -v node &> /dev/null; then
    log_error "Node.js is required"
    exit 1
  fi
  
  # 在输出目录中安装 puppeteer
  mkdir -p "$OUTPUT_DIR"
  cd "$OUTPUT_DIR"
  
  if ! node -e "require('puppeteer')" 2>/dev/null; then
    log_info "Installing Puppeteer..."
    npm init -y > /dev/null 2>&1
    npm install puppeteer --save > /dev/null 2>&1
  fi
}

# 生成网络监控脚本
generate_network_monitor() {
  cat << 'SCRIPT'
const puppeteer = require('puppeteer');
const fs = require('fs');

async function monitorNetwork() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  const requests = [];
  const responses = [];
  const failedRequests = [];
  
  // 启用网络监控
  const client = await page.target().createCDPSession();
  await client.send('Network.enable');
  
  // 监听请求
  client.on('Network.requestWillBeSent', (params) => {
    requests.push({
      id: params.requestId,
      url: params.request.url,
      method: params.request.method,
      type: params.type,
      timestamp: params.timestamp,
      headers: params.request.headers
    });
  });
  
  // 监听响应
  client.on('Network.responseReceived', (params) => {
    responses.push({
      id: params.requestId,
      url: params.response.url,
      status: params.response.status,
      statusText: params.response.statusText,
      mimeType: params.response.mimeType,
      timing: params.response.timing,
      headers: params.response.headers
    });
  });
  
  // 监听失败请求
  client.on('Network.loadingFailed', (params) => {
    failedRequests.push({
      id: params.requestId,
      errorText: params.errorText,
      type: params.type
    });
  });
  
  try {
    // 访问页面
    await page.goto(process.env.TARGET_URL, { 
      waitUntil: 'networkidle2', 
      timeout: parseInt(process.env.TIMEOUT) 
    });
    
    // 等待额外网络活动
    await new Promise(r => setTimeout(r, 2000));
    
    // 分析结果
    const analysis = {
      summary: {
        totalRequests: requests.length,
        successfulResponses: responses.filter(r => r.status >= 200 && r.status < 300).length,
        failedRequests: failedRequests.length,
        errorResponses: responses.filter(r => r.status >= 400).length
      },
      requests: requests,
      responses: responses,
      failedRequests: failedRequests,
      slowRequests: responses
        .filter(r => r.timing && r.timing.receiveHeadersEnd)
        .sort((a, b) => b.timing.receiveHeadersEnd - a.timing.receiveHeadersEnd)
        .slice(0, 10),
      apiCalls: responses.filter(r => 
        r.mimeType && (r.mimeType.includes('json') || r.mimeType.includes('application'))
      )
    };
    
    console.log(JSON.stringify(analysis, null, 2));
    fs.writeFileSync('network-analysis.json', JSON.stringify(analysis, null, 2));
    
  } catch (error) {
    console.error('Network monitoring failed:', error.message);
  } finally {
    await browser.close();
  }
}

monitorNetwork().catch(console.error);
SCRIPT
}

# 生成性能分析脚本
generate_performance_audit() {
  cat << 'SCRIPT'
const puppeteer = require('puppeteer');
const fs = require('fs');

async function runPerformanceAudit() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  
  try {
    // 访问页面
    await page.goto(process.env.TARGET_URL, { 
      waitUntil: 'networkidle2',
      timeout: parseInt(process.env.TIMEOUT)
    });
    
    // 获取性能指标
    const metrics = await page.metrics();
    
    // 获取 Core Web Vitals
    const webVitals = await page.evaluate(() => {
      return new Promise((resolve) => {
        const vitals = {};
        
        // LCP (Largest Contentful Paint)
        new PerformanceObserver((list) => {
          const entries = list.getEntries();
          const lastEntry = entries[entries.length - 1];
          vitals.lcp = lastEntry.startTime;
        }).observe({ entryTypes: ['largest-contentful-paint'] });
        
        // FCP (First Contentful Paint)
        new PerformanceObserver((list) => {
          const entries = list.getEntries();
          vitals.fcp = entries[0].startTime;
        }).observe({ entryTypes: ['paint'] });
        
        // CLS (Cumulative Layout Shift)
        let clsValue = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) {
              clsValue += entry.value;
            }
          }
          vitals.cls = clsValue;
        }).observe({ entryTypes: ['layout-shift'] });
        
        // FID (First Input Delay)
        new PerformanceObserver((list) => {
          const entries = list.getEntries();
          vitals.fid = entries[0].processingStart - entries[0].startTime;
        }).observe({ entryTypes: ['first-input'] });
        
        // 等待一段时间收集数据
        setTimeout(() => {
          // 获取导航时间
          const navigationTiming = performance.getEntriesByType('navigation')[0];
          vitals.domContentLoaded = navigationTiming.domContentLoadedEventEnd - navigationTiming.startTime;
          vitals.loadComplete = navigationTiming.loadEventEnd - navigationTiming.startTime;
          
          resolve(vitals);
        }, 3000);
      });
    });
    
    // 获取资源大小
    const resources = await page.evaluate(() => {
      return performance.getEntriesByType('resource').map(r => ({
        name: r.name,
        duration: r.duration,
        size: r.transferSize || r.encodedBodySize,
        type: r.initiatorType
      }));
    });
    
    const analysis = {
      url: process.env.TARGET_URL,
      timestamp: new Date().toISOString(),
      metrics: {
        Timestamp: metrics.Timestamp,
        Documents: metrics.Documents,
        Frames: metrics.Frames,
        JSEventListeners: metrics.JSEventListeners,
        Nodes: metrics.Nodes,
        LayoutCount: metrics.LayoutCount,
        RecalcStyleCount: metrics.RecalcStyleCount,
        LayoutDuration: metrics.LayoutDuration,
        RecalcStyleDuration: metrics.RecalcStyleDuration,
        ScriptDuration: metrics.ScriptDuration,
        TaskDuration: metrics.TaskDuration,
        JSHeapUsedSize: metrics.JSHeapUsedSize,
        JSHeapTotalSize: metrics.JSHeapTotalSize
      },
      webVitals: webVitals,
      resources: {
        total: resources.length,
        totalSize: resources.reduce((sum, r) => sum + (r.size || 0), 0),
        byType: resources.reduce((acc, r) => {
          acc[r.type] = (acc[r.type] || 0) + 1;
          return acc;
        }, {}),
        slowest: resources.sort((a, b) => b.duration - a.duration).slice(0, 10),
        largest: resources.sort((a, b) => b.size - a.size).slice(0, 10)
      }
    };
    
    console.log(JSON.stringify(analysis, null, 2));
    fs.writeFileSync('performance-audit.json', JSON.stringify(analysis, null, 2));
    
  } catch (error) {
    console.error('Performance audit failed:', error.message);
  } finally {
    await browser.close();
  }
}

runPerformanceAudit().catch(console.error);
SCRIPT
}

# 生成内存检测脚本
generate_memory_leak_detector() {
  cat << 'SCRIPT'
const puppeteer = require('puppeteer');
const fs = require('fs');

async function detectMemoryLeaks() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  const heapSnapshots = [];
  
  try {
    // 访问页面
    await page.goto(process.env.TARGET_URL, { 
      waitUntil: 'networkidle2',
      timeout: parseInt(process.env.TIMEOUT)
    });
    
    // 初始堆快照
    const initialMetrics = await page.metrics();
    heapSnapshots.push({
      timestamp: Date.now(),
      jsHeapUsedSize: initialMetrics.JSHeapUsedSize,
      jsHeapTotalSize: initialMetrics.JSHeapTotalSize
    });
    
    // 模拟用户交互（10 次）
    for (let i = 0; i < 10; i++) {
      // 触发垃圾回收（需要 Chrome 启动时添加 --expose-gc 参数）
      await page.evaluate(() => {
        if (window.gc) window.gc();
      });
      
      // 点击页面元素
      const buttons = await page.$$('button, a, [role="button"]');
      if (buttons.length > 0) {
        await buttons[i % buttons.length].click().catch(() => {});
        await new Promise(r => setTimeout(r, 500));
      }
      
      // 记录堆大小
      const metrics = await page.metrics();
      heapSnapshots.push({
        timestamp: Date.now(),
        jsHeapUsedSize: metrics.JSHeapUsedSize,
        jsHeapTotalSize: metrics.JSHeapTotalSize,
        interaction: i + 1
      });
    }
    
    // 分析内存增长趋势
    const initialHeap = heapSnapshots[0].jsHeapUsedSize;
    const finalHeap = heapSnapshots[heapSnapshots.length - 1].jsHeapUsedSize;
    const heapGrowth = finalHeap - initialHeap;
    const growthPercent = (heapGrowth / initialHeap) * 100;
    
    const analysis = {
      url: process.env.TARGET_URL,
      timestamp: new Date().toISOString(),
      summary: {
        initialHeapMB: (initialHeap / 1024 / 1024).toFixed(2),
        finalHeapMB: (finalHeap / 1024 / 1024).toFixed(2),
        heapGrowthMB: (heapGrowth / 1024 / 1024).toFixed(2),
        growthPercent: growthPercent.toFixed(2),
        potentialLeak: growthPercent > 50 // 如果增长超过 50%，可能存在泄漏
      },
      snapshots: heapSnapshots.map(s => ({
        ...s,
        jsHeapUsedMB: (s.jsHeapUsedSize / 1024 / 1024).toFixed(2)
      })),
      recommendation: growthPercent > 50 
        ? 'Possible memory leak detected. Heap grew more than 50% during interactions.'
        : 'No obvious memory leak detected. Heap growth is within normal range.'
    };
    
    console.log(JSON.stringify(analysis, null, 2));
    fs.writeFileSync('memory-analysis.json', JSON.stringify(analysis, null, 2));
    
  } catch (error) {
    console.error('Memory detection failed:', error.message);
  } finally {
    await browser.close();
  }
}

detectMemoryLeaks().catch(console.error);
SCRIPT
}

# 生成安全审计脚本
generate_security_audit() {
  cat << 'SCRIPT'
const puppeteer = require('puppeteer');
const fs = require('fs');

async function runSecurityAudit() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  const issues = [];
  
  try {
    // 监听控制台错误
    page.on('console', msg => {
      if (msg.type() === 'error') {
        issues.push({
          type: 'console_error',
          message: msg.text(),
          severity: 'medium'
        });
      }
    });
    
    // 访问页面
    const response = await page.goto(process.env.TARGET_URL, { 
      waitUntil: 'networkidle2',
      timeout: parseInt(process.env.TIMEOUT)
    });
    
    // 检查 HTTPS
    const url = page.url();
    if (!url.startsWith('https://')) {
      issues.push({
        type: 'insecure_connection',
        message: 'Page is not served over HTTPS',
        severity: 'high'
      });
    }
    
    // 检查安全头
    const headers = response.headers();
    
    // Content-Security-Policy
    if (!headers['content-security-policy']) {
      issues.push({
        type: 'missing_header',
        message: 'Content-Security-Policy header is missing',
        severity: 'medium'
      });
    }
    
    // X-Frame-Options
    if (!headers['x-frame-options']) {
      issues.push({
        type: 'missing_header',
        message: 'X-Frame-Options header is missing',
        severity: 'low'
      });
    }
    
    // X-XSS-Protection
    if (!headers['x-xss-protection']) {
      issues.push({
        type: 'missing_header',
        message: 'X-XSS-Protection header is missing',
        severity: 'low'
      });
    }
    
    // Strict-Transport-Security
    if (!headers['strict-transport-security']) {
      issues.push({
        type: 'missing_header',
        message: 'Strict-Transport-Security header is missing',
        severity: 'medium'
      });
    }
    
    // 检查混合内容
    const mixedContent = await page.evaluate(() => {
      const issues = [];
      
      // 检查 HTTP 资源
      document.querySelectorAll('script[src], link[href], img[src]').forEach(el => {
        const src = el.src || el.href;
        if (src && src.startsWith('http://')) {
          issues.push({
            type: 'mixed_content',
            element: el.tagName,
            url: src
          });
        }
      });
      
      return issues;
    });
    
    issues.push(...mixedContent.map(mc => ({
      type: 'mixed_content',
      message: `Insecure ${mc.element} loaded: ${mc.url}`,
      severity: 'high'
    })));
    
    // 检查表单安全
    const insecureForms = await page.evaluate(() => {
      const forms = [];
      document.querySelectorAll('form').forEach(form => {
        if (form.action && form.action.startsWith('http://')) {
          forms.push({
            action: form.action,
            method: form.method
          });
        }
      });
      return forms;
    });
    
    issues.push(...insecureForms.map(f => ({
      type: 'insecure_form',
      message: `Form submits to insecure URL: ${f.action}`,
      severity: 'high'
    })));
    
    const analysis = {
      url: process.env.TARGET_URL,
      timestamp: new Date().toISOString(),
      summary: {
        totalIssues: issues.length,
        high: issues.filter(i => i.severity === 'high').length,
        medium: issues.filter(i => i.severity === 'medium').length,
        low: issues.filter(i => i.severity === 'low').length
      },
      headers: headers,
      issues: issues,
      secure: issues.filter(i => i.severity === 'high').length === 0
    };
    
    console.log(JSON.stringify(analysis, null, 2));
    fs.writeFileSync('security-audit.json', JSON.stringify(analysis, null, 2));
    
  } catch (error) {
    console.error('Security audit failed:', error.message);
  } finally {
    await browser.close();
  }
}

runSecurityAudit().catch(console.error);
SCRIPT
}

# 运行网络监控
run_network_monitor() {
  local url="$1"
  
  log_info "Starting network monitoring for: $url"
  mkdir -p "$OUTPUT_DIR"
  cd "$OUTPUT_DIR"
  
  generate_network_monitor > network-monitor.js
  
  export TARGET_URL="$url"
  export TIMEOUT="$TIMEOUT"
  
  node network-monitor.js 2>&1 | tee network.log
  
  if [ -f "network-analysis.json" ]; then
    log_info "Network analysis completed"
    cat network-analysis.json | jq '.summary'
  fi
}

# 运行性能审计
run_performance_audit() {
  local url="$1"
  
  log_info "Running performance audit for: $url"
  mkdir -p "$OUTPUT_DIR"
  cd "$OUTPUT_DIR"
  
  generate_performance_audit > performance-audit.js
  
  export TARGET_URL="$url"
  export TIMEOUT="$TIMEOUT"
  
  node performance-audit.js 2>&1 | tee performance.log
  
  if [ -f "performance-audit.json" ]; then
    log_info "Performance audit completed"
    cat performance-audit.json | jq '.webVitals'
  fi
}

# 运行内存检测
run_memory_detection() {
  local url="$1"
  
  log_info "Detecting memory leaks for: $url"
  mkdir -p "$OUTPUT_DIR"
  cd "$OUTPUT_DIR"
  
  generate_memory_leak_detector > memory-detector.js
  
  export TARGET_URL="$url"
  export TIMEOUT="$TIMEOUT"
  
  node memory-detector.js 2>&1 | tee memory.log
  
  if [ -f "memory-analysis.json" ]; then
    log_info "Memory analysis completed"
    cat memory-analysis.json | jq '.summary'
  fi
}

# 运行安全审计
run_security_audit() {
  local url="$1"
  
  log_info "Running security audit for: $url"
  mkdir -p "$OUTPUT_DIR"
  cd "$OUTPUT_DIR"
  
  generate_security_audit > security-audit.js
  
  export TARGET_URL="$url"
  export TIMEOUT="$TIMEOUT"
  
  node security-audit.js 2>&1 | tee security.log
  
  if [ -f "security-audit.json" ]; then
    log_info "Security audit completed"
    cat security-audit.json | jq '.summary'
  fi
}

# 运行全部检测
run_all() {
  local url="$1"
  
  log_info "Running all diagnostics for: $url"
  
  run_network_monitor "$url"
  echo ""
  run_performance_audit "$url"
  echo ""
  run_memory_detection "$url"
  echo ""
  run_security_audit "$url"
  
  log_info "All diagnostics completed. Results in: $OUTPUT_DIR"
}

# 主函数
main() {
  check_dependencies
  
  case "$ACTION" in
    network)
      if [ -z "$URL" ]; then
        log_error "URL is required"
        echo "Usage: $0 network <url>"
        exit 1
      fi
      run_network_monitor "$URL"
      ;;
    
    performance)
      if [ -z "$URL" ]; then
        log_error "URL is required"
        echo "Usage: $0 performance <url>"
        exit 1
      fi
      run_performance_audit "$URL"
      ;;
    
    memory)
      if [ -z "$URL" ]; then
        log_error "URL is required"
        echo "Usage: $0 memory <url>"
        exit 1
      fi
      run_memory_detection "$URL"
      ;;
    
    security)
      if [ -z "$URL" ]; then
        log_error "URL is required"
        echo "Usage: $0 security <url>"
        exit 1
      fi
      run_security_audit "$URL"
      ;;
    
    all)
      if [ -z "$URL" ]; then
        log_error "URL is required"
        echo "Usage: $0 all <url>"
        exit 1
      fi
      run_all "$URL"
      ;;
    
    *)
      log_error "Unknown action: $ACTION"
      echo "Actions: network, performance, memory, security, all"
      exit 1
      ;;
  esac
}

main "$@"
