(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof exports === "object") {
        module.exports = factory();
    } else {
        root.AMDModule = factory();
    }
}(this, function () {
    const AMDModule = {
        version: '0.0.1',
    };

    // utils
    function toArray(obj) {
        return Array.prototype.slice.call(obj);
    }
    function forIn(obj, callback, thisObj) {
        for (const key in obj) {
            if ({}.hasOwnProperty.call(obj, key)) {
                callback.call(thisObj, obj[key], key, obj);
            }
        }
    }
    const toString = {}.toString;
    const isType = (obj, type) => toString.call(obj) === `[object ${type}]`;
    function isFunction(obj) {
        return isType(obj, 'Function');
    }
    function isString(obj) {
        return isType(obj, 'String');
    }

    // events
    let events = {};
    Object.assign(AMDModule, {
        events,
        // event utils
        on(name, callback, context) {
            const list = events[name] || (events[name] = []);
            list.push({
                callback : callback,
                context  : context
            });
            return AMDModule;
        },
        off(name, callback) {
            if (!name) {
                events = {};
                return AMDModule;
            }
            let list = events[name] || [];
            let i = list.length;
            if (!callback) {
                list = [];
            } else {
                while (i > 0) {
                    i --;
                    if (list[i].callback === callback) {
                        list.splice(i, 1);
                    }
                }
            }
            events[name] = list;
            return AMDModule;
        },
        emit() {
            const args = toArray(arguments);
            let list = events[args.shift()] || [];
            list.forEach(evt => {
                if (!evt.callback) {
                    throw 'event callback is not defined';
                }
                evt.callback.apply(evt.context, args);
            });
            return AMDModule;
        }
    });


    let undef;
    const undefStr = 'undefined';

    // global
    let GLOBAL;
    let isInWindow = false;
    if (typeof window !== undefStr) {
        GLOBAL = window;
        AMDModule.isInWindow = isInWindow = true;
    }
    if (typeof global !== undefStr) {
        GLOBAL = global;
    }
    if (typeof self !== undefStr) {
        GLOBAL = self;
    }

    const moduleByUri = {};
    const exportsByUri = {};
    const executedByUri = {};
    const queueByUri = {}; // queue to be executed

    // Module
    class Module {
        constructor(meta) {
            const mod = this;
            Object.assign(mod, meta);
            const uri = mod.id;
            if (uri && !moduleByUri[uri]) {
                moduleByUri[uri] = mod;
            }
            const id = mod.id;
            if (id && !moduleByUri[id]) {
                moduleByUri[id] = mod;
            }
            const relativeUri = mod.relativeUri;
            if (relativeUri) {
                if (!moduleByUri[relativeUri]) {
                    moduleByUri[relativeUri] = mod;
                }
                if (!queueByUri[relativeUri]) {
                    queueByUri[relativeUri] = mod;
                }
            }
            AMDModule.emit('module-initialised', mod);
            return mod;
        }
        processDeps() {
            const mod = this;
            AMDModule.emit('module-deps-processed', mod);
            return mod;
        }
        execute() {
            const mod = this;
            const depModExports = [];
            if ('exports' in mod) {
                delete queueByUri[mod.relativeUri];
                return mod;
            }

            if (mod.deps.every(uri => !!executedByUri[uri])) {
                const modFactory = mod.factory;
                const modUri = mod.uri;
                const modId = mod.id;
                const modRelativeUri = mod.relativeUri;

                mod.deps.forEach(uri => {
                    depModExports.push(exportsByUri[uri]);
                });
                mod.exports = exportsByUri[modUri] = exportsByUri[modId] = exportsByUri[modRelativeUri]
                    = isFunction(modFactory) ? modFactory.apply(undef, depModExports) : modFactory;
                executedByUri[modUri] = executedByUri[modId] = executedByUri[modRelativeUri] = true;
                // next
                forIn(queueByUri, mod2BeExecuted/*, uri */ => {
                    if (mod2BeExecuted instanceof Module) {
                        mod2BeExecuted.execute();
                    }
                });
                AMDModule.emit('module-executed', mod);
            }
            return mod;
        }
    }
    AMDModule.Module = Module;

    // define
    if (GLOBAL.define) {
        throw 'the "define" function exists';
    }
    function define(/* id, deps, factory */) {
        const args = toArray(arguments);
        const id = isString(args[0]) ? args.shift() : undef;
        const deps = args.length > 1 ? args.shift() : [];
        const factory = args[0];
        const meta = {
            id,
            uri: id,
            deps,
            factory
        };
        AMDModule.emit('module-meta-got', meta);
        const mod = new Module(meta)
            .processDeps()
            .execute();
        AMDModule.emit('module-defined', mod);
    }
    define.amd = {}; // minimum AMD implement
    AMDModule.define = GLOBAL.define = Module.define = define; // register define function

    // loader functionality is not available in non-browser environments
    if (!isInWindow) {
        return AMDModule;
    }

    // path utils
    const re_absolute = /^\/\/.|:\//;
    const re_dirname = /[^?#]*\//;
    const re_dot = /\/\.\//g;
    const re_doubleDot = /\/[^/]+\/\.\.\//;
    const re_ignoreLocation = /^(about|blob):/;
    const re_multiSlash = /([^:/])\/+\//g;
    const re_path = /^([^/:]+)(\/.+)$/;
    const re_rootDir = /^.*?\/\/.*?\//;
    const doc = document;
    const lc = location;
    const href = lc.href;
    const scripts = doc.scripts;
    const loaderScript = doc.getElementById('moduleLoader') || scripts[scripts.length - 1];
    const loaderPath = loaderScript.hasAttribute ? /* non-IE6/7 */ loaderScript.src : loaderScript.getAttribute('src', 4);

    function dirname(path) {
        // dirname('a/b/c.js?t=123#xx/zz') ==> 'a/b/'
        return path.match(re_dirname)[0];
    }
    function realpath(path) {
        path = path.replace(re_dot, '/'); // /a/b/./c/./d ==> /a/b/c/d
        // a//b/c ==> a/b/c
        // a///b/////c ==> a/b/c
        // DOUBLE_DOT_RE matches a/b/c//../d path correctly only if replace // with / first
        path = path.replace(re_multiSlash, '$1/');
        while (path.match(re_doubleDot)) {
            // a/b/c/../../d  ==>  a/b/../d  ==>  a/d
            path = path.replace(re_doubleDot, '/');
        }
        return path;
    }
    function normalize(path) {
        // normalize('path/to/a') ==> 'path/to/a.js'
        let last  = path.length - 1,
            lastC = path.charCodeAt(last);
        if (lastC === 35 /* '#' */) {
            // If the uri ends with `#`, just return it without '#'
            return path.substring(0, last);
        }
        return (path.substring(last - 2) === '.js' || path.indexOf('?') > 0 || lastC === 47 /* '/' */) ?
            path : (path + '.js');
    }
    function parseAlias(id) {
        const alias = AMDModule.alias;
        return alias && isString(alias[id]) ? alias[id] : id;
    }
    function parsePaths(id) {
        let m;
        let paths = AMDModule.paths;
        if (paths && (m = id.match(re_path)) && isString(paths[m[1]])) {
            id = paths[m[1]] + m[2];
        }
        return id;
    }
    function addBase(id, refUri) {
        let ret;
        let first = id.charCodeAt(0);

        if (re_absolute.test(id)) { // Absolute
            ret = id;
        } else if (first === 46 /* '.' */) { // Relative
            ret = (refUri ? dirname(refUri) : cwd) + id;
        } else if (first === 47 /* '/' */) { // Root
            let m = cwd.match(re_rootDir);
            ret = m ? m[0] + id.substring(1) : id;
        } else { // Top-level
            ret = AMDModule.base + id;
        }
        if (ret.indexOf('//') === 0) { // Add default protocol when uri begins with '//'
            ret = lc.protocol + ret;
        }
        return realpath(ret);
    }
    function id2Uri(id, refUri) {
        if (!id) {
            return '';
        }
        id = parseAlias(id);
        id = parsePaths(id);
        id = parseAlias(id);
        id = normalize(id);
        id = parseAlias(id);

        let uri = addBase(id, refUri);
        uri = parseAlias(uri);
        return uri;
    }
    const cwd = (!href || re_ignoreLocation.test(href)) ? '' : dirname(href);
    const path = loaderPath;
    const dir = dirname(loaderPath || cwd);
    Object.assign(AMDModule, {
        cwd,
        path,
        dir,
        base: dir,
        dirname,
        realpath,
        normalize,
        parseAlias,
        addBase,
        id2Uri,
        resolve: id2Uri,
    });

    // request
    const head = doc.head || doc.getElementsByTagName('head')[0] || doc.documentElement;
    const baseElement = head.getElementsByTagName('base')[0];

    function addOnload(node, callback, url) {
        const supportOnload = 'onload' in node;

        function onload(error) {
            // Ensure only run once and handle memory leak in IE
            node.onload = node.onerror = node.onreadystatechange = null;
            // Dereference the node
            node = null;
            if (isFunction(callback)) {
                callback(error);
            }
        }

        if (supportOnload) {
            node.onload = onload;
            node.onerror = function () {
                AMDModule.emit('error', { uri: url, node: node });
                onload(true);
            };
        } else {
            node.onreadystatechange = function () {
                if (/loaded|complete/.test(node.readyState)) {
                    onload();
                }
            };
        }
    }
    function request(url, callback, charset, crossorigin) {
        const node = doc.createElement('script');

        if (charset) {
            const cs = isFunction(charset) ? charset(url) : charset;
            if (cs) {
                node.charset = cs;
            }
        }
        // crossorigin default value is `false`.
        const cors = isFunction(crossorigin) ? crossorigin(url) : crossorigin;
        if (cors !== false) {
            node.crossorigin = cors;
        }
        addOnload(node, callback, url);

        node.async = true;
        node.src = url;
        /*
         * For some cache cases in IE 6-8, the script executes IMMEDIATELY after
         * the end of the insert execution, so use `currentlyAddingScript` to
         * hold current node, for deriving url in `define` call
         */
        Module.currentlyAddingScript = node;
        if (baseElement) {
            head.insertBefore(node, baseElement); // ref: #185 & http://dev.jquery.com/ticket/2709
        } else {
            head.appendChild(node);
        }
        Module.currentlyAddingScript = null;
    }
    Object.assign(AMDModule, {
        addOnload,
        request,
    });

    // loader
    let interactiveScript;
    const loadingByUri = {};

    function getCurrentScript() {
        if (Module.currentlyAddingScript) {
            return Module.currentlyAddingScript.src;
        }
        if (doc.currentScript) { // firefox 4+
            return doc.currentScript.src;
        }
        // reference: https://github.com/samyk/jiagra/blob/master/jiagra.js
        let stack;
        try {
            throw new Error();
        } catch(e) { // safari: only `line`, `sourceId` and `sourceURL`
            stack = e.stack;
            if (!stack && window.opera) {
                // opera 9 does not have `e.stack`, but `e.Backtrace`
                stack = (String(e).match(/of linked script \S+/g) || []).join(' ');
            }
        }
        if (stack) {
            /*
             * e.stack:
             * chrome23: at http://113.93.50.63/data.js:4:1
             * firefox17: @http://113.93.50.63/query.js:4
             * opera12: @http://113.93.50.63/data.js:4
             * IE10: at Global code (http://113.93.50.63/data.js:4:1)
             */
            stack = stack.split( /[@ ]/g).pop(); // at last line, after the last space or @
            stack = (stack[0] === '(') ? stack.slice(1, -1) : stack;
            return stack.replace(/(:\d+)?:\d+$/i, '');
        }
        if (interactiveScript && interactiveScript.readyState === "interactive") {
            return interactiveScript.src;
        }
        let nodes = doc.getElementsByTagName('script');
        for (let i = 0, node; node = nodes[i++];) {
            if (node.readyState === 'interactive') {
                interactiveScript = node;
                return node.src;
            }
        }
    }

    let relativeIdCounter = 0;
    let uuid = 0;
    AMDModule
        .on('module-meta-got', meta => {
            const src = getCurrentScript();
            if (src) {
                meta.uri = src;
            } else {
                meta.uri = cwd;
            }
            if (src === '' || (isString(src) && src === cwd)) {
                if (meta.id) { // named module in script tag
                    // meta.id = './' + meta.id; // @FIXME
                } else { // script tag
                    meta.uri = cwd + ('#' + uuid ++);
                }
            }
        })
        .on('module-initialised', mod => {
            if (!(isString(mod.uri) && mod.uri.indexOf('/') > -1)) {
                mod.uri = id2Uri(mod.id);
            }
            const uri = mod.uri;
            const id = mod.id || relativeIdCounter ++;
            mod.relativeUri = uri.indexOf(id+'.') > -1 ? uri : id2Uri('./' + id, uri);
        })
        .on('module-deps-processed', function (mod) {
            mod.deps.forEach((id, index) => {
                let uri;
                if (moduleByUri[id]) {
                    uri = id;
                } else {
                    uri = id2Uri(id, mod.relativeUri || mod.uri);
                }
                mod.deps[index] = uri;
                if (!moduleByUri[uri] && !loadingByUri[uri] && !executedByUri[uri]) {
                    request(uri);
                    loadingByUri[uri] = true;
                }
            });
        });

    return AMDModule;
}));
