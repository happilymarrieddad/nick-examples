const path = require('path');
const esbuild  = require('esbuild');
const babelJest = require('babel-jest');
const getCacheKey = require('@jest/create-cache-key-function')

/**
 * copied from: https://github.com/aelbore/esbuild-jest
 */
const babelTransformer = babelJest.default.createTransformer({
  plugins: [ '@babel/plugin-transform-modules-commonjs' ],
  presets: [
    '@babel/preset-typescript'
  ],
  parserOpts: {
    plugins: ['jsx', 'typescript'],
  }
})

function babelTransform(opts) {
  const { sourceText, sourcePath, config, options } = opts
  const babelResult = babelTransformer.process(sourceText, sourcePath, config, options);
  return babelResult.code
}

const loaders = ["js", "jsx", "ts", "tsx", "json"];
const getExt = (str) => {
  const basename = path.basename(str);
  const firstDot = basename.indexOf('.');
  const lastDot = basename.lastIndexOf('.');
  const extname = path.extname(basename).replace(/(\.[a-z0-9]+).*/i, '$1');
  if (firstDot === lastDot) return extname
  return basename.slice(firstDot, lastDot) + extname
}

const createTransformer = (options) => {
  const process = (content, filename, config, opts) => {
    try {
      const sources = { code: content }
      const ext = getExt(filename), extName = path.extname(filename).slice(1)
      const enableSourcemaps = options?.sourcemap || false
      const loader = (options?.loaders && options?.loaders[ext]
          ? options.loaders[ext]
          : loaders.includes(extName) ? extName: 'text'
      )
      const sourcemaps = enableSourcemaps
        ? { sourcemap: true, sourcesContent: false, sourcefile: filename }
        : {}

      /**
       * partially pulled from ts-jest: https://github.com/kulshekhar/ts-jest/blob/main/src/transformers/hoist-jest.ts#L27
       */
      const hasJestHoistedMethods = (code) => {
        let hasMethod = false;
        const HOIST_METHODS = ['mock', 'unmock', 'enableAutomock', 'disableAutomock', 'deepUnmock'];
        HOIST_METHODS.forEach((methodName) => {
          // include "(" to match on method being called
          if (code.indexOf(`${methodName}(`) >= 0) {
            hasMethod = true;
          }
        })
        return hasMethod;
      }

      if (hasJestHoistedMethods(sources.code) || opts?.instrument) {
        const source = babelTransform({
          sourceText: content,
          sourcePath: filename,
          config,
          options: opts
        })
        sources.code = source
      }

      const result = esbuild.transformSync(sources.code, {
        loader,
        format: options?.format || 'cjs',
        target: options?.target || 'es2018',
        ...(options?.jsxFactory ? { jsxFactory: options.jsxFactory }: {}),
        ...(options?.jsxFragment ? { jsxFragment: options.jsxFragment }: {}),
        ...sourcemaps
      })
      let { map, code } = result;
      if (enableSourcemaps) {
        map = {
          ...JSON.parse(result.map),
          sourcesContent: undefined,
        }
        // Append the inline sourcemap manually to ensure the "sourcesContent"
        // is null. Otherwise, breakpoints won't pause within the actual source.
        code = code + '\n//# sourceMappingURL=data:application/json;base64,' + Buffer.from(JSON.stringify(map)).toString('base64')
      } else {
        map = null
      }
      return { code, map }
    } catch (e) {
      console.error(e);
      return { code: undefined, map: undefined }
    }
  }
  return {
    process,
    // see: https://jestjs.io/docs/code-transformation
    // "... we highly recommend implementing getCacheKey as well, so we don't waste resources transpiling the same source file when we can read its previous result from disk."
    getCacheKey,
  };
}

const transformer = {
  canInstrument: true,
  createTransformer
}

module.exports = transformer
