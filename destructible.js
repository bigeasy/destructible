var cadence = require('cadence')
var nop = require('nop')
var coalesce = require('extant')
var Keyify = require('keyify')
var Operation = require('operation/variadic')
var Procession = require('procession')
var Monotonic = require('monotonic').asString
var INSTANCE = '0'
var Signal = require('signal')

var instance = 0
function Destructible (key) {
    this.destroyed = false
    this.errors = []
    this.events = new Procession

    var vargs = Array.prototype.slice.call(arguments)

    this.key = coalesce(key)
    this._destructors = {}
    this._markers = []
    this._waiting = []
    this._instance = INSTANCE = Monotonic.increment(INSTANCE, 0)
    this.ready = new Signal
    this.ready.unlatch()
    this.ready.instance = ++instance
}

Destructible.prototype.destroy = function (error) {
    if (error) {
        this.check()
        this.cause = error
    }
    if (!this.destroyed) {
        this._error = new Error().stack
        this.events.push({
            module: 'destructible',
            method: 'destroyed',
            from: this._instance,
            body: {
                destructible: this.key,
                waiting: this._waiting.slice(),
                cause: this.cause
            }
        })
        this.destroyed = true
        for (var key in this._destructors) {
            this._destructors[key].call()
        }
        this._destructors = null
        this._markers.forEach(function (f) { f() })
        this._markers = null
    }
}

Destructible.prototype.markDestroyed = function (object, property) {
    this._markers.push(function () { object[coalesce(property, 'destroyed')] = true })
}

Destructible.prototype.addDestructor = function (key) {
    key = Keyify.stringify(key)
    var operation = Operation(Array.prototype.slice.call(arguments, 1))
    if (this.destroyed) {
        operation()
    } else {
        this._destructors[key] = operation
    }
}

Destructible.prototype.invokeDestructor = function (key) {
    key = Keyify.stringify(key)
    if (this._destructors == null) {
        console.log({
            cause: this.cause && this.cause.stack,
            stack: this._error,
            when: this.when,
            destroyed: this.destroyed
        })
    }
    var destructor = this._destructors[key]
    destructor()
    delete this._destructors[key]
}

Destructible.prototype.removeDestructor = function (key) {
    key = Keyify.stringify(key)
    delete this._destructors[key]
}

Destructible.prototype.getDestructors = function () {
    return Object.keys(this._destructors).map(function (key) {
        return Keyify.parse(key)
    })
}

Destructible.prototype.check = function (interrupt) {
    if (this.destroyed) {
        interrupt || (interrupt = require('interrupt').createInterrupter('destructible'))
        throw interrupt('destroyed', {}, { cause: coalesce(this.cause) })
    }
}

function _async (destructible, async, key) {
    if (destructible.destroyed) {
        return function () {}
    }
    var previous = destructible.ready
    var ready = destructible.ready = new Signal
    destructible.ready.instance = ++instance
    return function () {
        var vargs = Array.prototype.slice.call(arguments)
        var waiting = { destructor: key }
        destructible._waiting.push(waiting)
        async([function () {
            destructible.destroy()
            destructible._waiting.splice(destructible._waiting.indexOf(waiting), 1)
            destructible.events.push({
                module: 'destructible',
                method: 'popped',
                from: destructible._instance,
                body: {
                    destructible: destructible.key,
                    destructor: key,
                    waiting: destructible._waiting.slice(),
                    cause: destructible.cause
                }
            })
        }], [function () {
            async(function () {
                previous.wait(async())
            }, function () {
                async.apply(null, [
                    function () { return [ ready ] }
                ].concat(vargs))
            })
        }, function (error) {
            if (!destructible.destroyed) {
                destructible.destroy(error)
            }
            ready.unlatch(destructible.cause)
            throw error
        }])
    }
}

Destructible.prototype._stack = cadence(function (async, vargs) {
    _async(this, async, vargs.shift())(function (ready) {
        Operation(vargs)(ready, async())
    })

})

Destructible.prototype.stack = function () {
    var vargs = Array.prototype.slice.call(arguments)
    if (typeof vargs[0] == 'function') {
        return _async(this, vargs[0], vargs[1])
    } else {
        this._stack(vargs, vargs.pop())
    }
}

function _rescue (destructible, async) {
    return function () {
        var vargs = Array.prototype.slice.call(arguments)
        var ready = destructible.ready
        console.log(ready.instance)
        async([function () {
            async(function () {
                ready.wait(async())
            }, function () {
                async.apply(null, vargs)
            })
        }, function (error) {
            if (!destructible.destroyed) {
                destructible.destroy(error)
            }
            throw error
        }])
    }
}

Destructible.prototype._rescue = cadence(function (async, vargs) {
    _rescue(this, async)(function () {
        Operation(vargs)(async())
    })
})

Destructible.prototype.rescue = function () {
    var vargs = Array.prototype.slice.call(arguments)
    switch (vargs.length) {
    case 0:
        return function (error) { if (error) this.destroy(error) }.bind(this)
    case 1:
        return _rescue(this, vargs[0])
    default:
        this._rescue(vargs, vargs.pop())
    }
}

module.exports = Destructible
