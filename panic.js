var interrupt = require('interrupt').createInterrupter('destructible')

exports.createPanicIf = function (setImmediate) {
    return function (condition, name, context, properties) {
        if (condition) {
            setImmediate(function () {
                throw new interrupt(name, context, properties)
            })
        }
    }
}

exports.panicIf = exports.createPanicIf(setImmediate)
