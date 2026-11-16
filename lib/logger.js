// AUTOJIRA central logger
// 브라우저: window.AutoJiraLogger / Node: module.exports
(function(global){
    const LOG_BUFFER_MAX=200;
    const _buffer=[];

    function _push(level,args){
        _buffer.push({level,ts:Date.now(),msg:args.map(a=>{
            if(a instanceof Error)return a.message+(a.stack?'\n'+a.stack:'');
            if(typeof a==='object')try{return JSON.stringify(a);}catch{return String(a);}
            return String(a);
        }).join(' ')});
        while(_buffer.length>LOG_BUFFER_MAX)_buffer.shift();
    }

    function _fmt(level,args){
        return ['[AUTOJIRA]','['+level.toUpperCase()+']',...args];
    }

    const logger={
        debug(...args){if(typeof console!=='undefined'&&console.debug)console.debug(..._fmt('debug',args));},
        info(...args){_push('info',args);if(typeof console!=='undefined')console.info(..._fmt('info',args));},
        warn(...args){_push('warn',args);if(typeof console!=='undefined')console.warn(..._fmt('warn',args));},
        error(...args){_push('error',args);if(typeof console!=='undefined')console.error(..._fmt('error',args));},
        // 최근 N건 조회 (기본: 모든 버퍼)
        recent(n){return n?_buffer.slice(-n):_buffer.slice();},
        // 레벨로 필터
        byLevel(level){return _buffer.filter(e=>e.level===level);},
        clear(){_buffer.length=0;},
        // 디버그용: 텍스트 dump
        dump(){return _buffer.map(e=>`${new Date(e.ts).toISOString()} [${e.level}] ${e.msg}`).join('\n');}
    };

    if(typeof module!=='undefined'&&module.exports)module.exports=logger;
    else if(global)global.AutoJiraLogger=logger;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:this);
