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
    this.cause = null
    this.events = new Procession

    var vargs = Array.prototype.slice.call(arguments)

    this.key = coalesce(key)
    this._destructors = {}
    this._markers = []
    this._waiting = []
    this._instance = INSTANCE = Monotonic.increment(INSTANCE, 0)
    this._ready = new Signal
    this._ready.unlatch()
    this._ready.instance = ++instance
}

Destructible.prototype.destroy = function (error) {
    if (error) {
        this.check()
        this.cause = error
    }
    if (!this.destroyed) {
        this._stack = new Error().stack
        this.events.push({
            module: 'destructible',
            method: 'destroyed',
            from: this._instance,
            body: {
                destructor: this.key,
                waiting: this._waiting.slice(),
                cause: this.cause
            }
        })
        this.destroyed = true
        for (var name in this._destructors) {
            this._destructors[name].call()
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
            stack: this._stack,
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

Destructible.prototype.destructible = cadence(function (async) {
    var vargs = Array.prototype.slice.call(arguments, 1)
    var name = typeof vargs[0] == 'string' ? vargs.shift() : null
    this.async(async, name)(function (ready) {
        Operation(vargs)(ready, async())
    })
})

function _async (destructible, async, name) {
    if (destructible.destroyed) {
        return function () {}
    }
    var previous = destructible._ready
    var ready = destructible._ready = new Signal
    destructible._ready.instance = ++instance
    return function () {
        var vargs = Array.prototype.slice.call(arguments)
        var waiting = { destructible: name }
        destructible._waiting.push(waiting)
        async([function () {
            destructible.destroy()
            destructible._waiting.splice(destructible._waiting.indexOf(waiting), 1)
            destructible.events.push({
                module: 'destructible',
                method: 'popped',
                from: destructible._instance,
                body: {
                    destructor: destructible.key,
                    destructible: name,
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
            ready.unlatch(this.cause)
            throw error
        }])
    }
}

Destructible.prototype.async = function (async, name) {
    return _async(this, async, name)
}

Destructible.prototype.rescue = function () {
    return function (error) { if (error) this.destroy(error) }.bind(this)
}

module.exports = Destructible
