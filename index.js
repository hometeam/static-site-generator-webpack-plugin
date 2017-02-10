var RawSource = require('webpack-sources/lib/RawSource');
var evaluate = require('eval');
var path = require('path');
var Promise = require('bluebird');
var fs = require('fs');

function StaticSiteGeneratorWebpackPlugin(renderSrc, outputPaths, locals, scope, options) {
  this.renderSrc = renderSrc;
  this.options = options;
  this.outputPaths = Array.isArray(outputPaths) ? outputPaths : [outputPaths];
  this.locals = locals;
  this.scope = scope;
}

//TODO Make this prettier.
function addAssets(file, options, locals) {

  const scripts = [
    '<script src="' + locals.staticFolder + '/main.bundle.js" ></script>',
  ];

  const styles = [
    '<link rel="stylesheet" href="' + locals.staticFolder + '/main.less-bundle.css" />'
  ];

  var fileWithAssets = file.replace('<!-- scripts -->', scripts.join(' '));
  fileWithAssets = fileWithAssets.replace('<!-- styles -->', styles.join(' '));

  return fileWithAssets;
}


StaticSiteGeneratorWebpackPlugin.prototype.apply = function(compiler) {
  var self = this;

  compiler.plugin('this-compilation', function(compilation) {

    console.log('this-COMPILATION', compilation, compilation.compiler, compilation.compiler.outputPath);

    try {
      var file = fs.readFileSync('index.html.tpl', "utf8");
      console.log(file);
    } catch (err) {
      console.log('failed');
    }

    compilation.plugin('optimize-assets', function(_, done) {


      var renderPromises;

      var webpackStats = compilation.getStats();
      var webpackStatsJson = webpackStats.toJson();

      try {
        var asset = findAsset(self.renderSrc, compilation, webpackStatsJson);

        if (asset == null) {
          throw new Error('Source file not found: "' + self.renderSrc + '"');
        }

        var assets = getAssetsFromCompilation(compilation, webpackStatsJson);

        file = addAssets(file, self.options, self.locals);

        var source = asset.source();
        var render = evaluate(source, /* filename: */ self.renderSrc, /* scope: */ self.scope, /* includeGlobals: */ true);

        if (render.hasOwnProperty('default')) {
          render = render['default'];
        }

        if (typeof render !== 'function') {
          throw new Error('Export from "' + self.renderSrc + '" must be a function that returns an HTML string');
        }

        renderPromises = self.outputPaths.map(function(outputPath) {
          var outputFileName = outputPath.replace(/^(\/|\\)/, ''); // Remove leading slashes for webpack-dev-server

          console.log(outputFileName);

          if (!/\.(html?)$/i.test(outputFileName)) {
            outputFileName = path.join(self.options.outputPathPrefix || '', self.options.outputRewriteFunction(outputFileName) || outputFileName);
          }

          var locals = {
            path: outputPath,
            assets: assets,
            webpackStats: webpackStats
          };

          for (var prop in self.locals) {
            if (self.locals.hasOwnProperty(prop)) {
              locals[prop] = self.locals[prop];
            }
          }

          var renderPromise = render.length < 2 ?
            Promise.resolve(render(locals)) :
            Promise.fromNode(render.bind(null, locals));

          return renderPromise
            .then(function(output) {
              var newOutput = file.replace('<!-- content -->', output);
              compilation.assets[outputFileName] = new RawSource(newOutput);
            })
            .catch(function(err) {
              compilation.errors.push(err.stack);
            });
        });

        Promise.all(renderPromises).nodeify(done);
      } catch (err) {
        compilation.errors.push(err.stack);
        done();
      }
    });
  });
};

var findAsset = function(src, compilation, webpackStatsJson) {
  var asset = compilation.assets[src];

  if (asset) {
    return asset;
  }

  var chunkValue = webpackStatsJson.assetsByChunkName[src];

  if (!chunkValue) {
    return null;
  }
  // Webpack outputs an array for each chunk when using sourcemaps
  if (chunkValue instanceof Array) {
    // Is the main bundle always the first element?
    chunkValue = chunkValue[0];
  }
  return compilation.assets[chunkValue];
};

// Shamelessly stolen from html-webpack-plugin - Thanks @ampedandwired :)
var getAssetsFromCompilation = function(compilation, webpackStatsJson) {
  var assets = {};
  for (var chunk in webpackStatsJson.assetsByChunkName) {
    var chunkValue = webpackStatsJson.assetsByChunkName[chunk];

    // Webpack outputs an array for each chunk when using sourcemaps
    if (chunkValue instanceof Array) {
      // Is the main bundle always the first element?
      chunkValue = chunkValue[0];
    }

    if (compilation.options.output.publicPath) {
      chunkValue = compilation.options.output.publicPath + chunkValue;
    }
    assets[chunk] = chunkValue;
  }

  return assets;
};

module.exports = StaticSiteGeneratorWebpackPlugin;
