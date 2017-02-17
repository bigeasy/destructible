var cadence = require('cadence')
var coalesce = require('nascent.coalesce')
var DEFAULT = {
    interrupt: require('interrupt').createInterrupter('destructible')
}
var Operation = require('operation')
var slice = [].slice
var Procession = require('procession')
var COOKIE = '0'
var Monotonic = require('monotonic').asString

function Destructor (name, interrupt) {
    this.destroyed = false
    this.cause = null
    this.events = new Procession

    var vargs = slice.call(arguments)

    this._name = typeof vargs[0] == 'string' ? vargs.shift() : null
    this._interrupt = coalesce(vargs[0], DEFAULT.interrupt)
    this._destructors = {}
    this._markers = []
    this._waiting = []
    this._instance = COOKIE = Monotonic.increment(COOKIE, 0)
}

Destructor.prototype.destroy = function (error) {
    if (error) {
        this.check()
        this.cause = error
    }
    if (!this.destroyed) {
        this.events.push({
            module: 'destructible',
            method: 'destroyed',
            from: this._instance,
            body: {
                destructor: this._name,
                waiting: this._waiting.slice(),
                cause: this.cause
            }
        })
        this.destroyed = true
        for (var name in this._destructors) {
            this._destructors[name].apply([])
        }
        this._destructors = null
        this._markers.forEach(function (f) { f() })
        this._markers = null
    }
}

Destructor.prototype.markDestroyed = function (object, property) {
    this._markers.push(function () { object[property] = true })
}

Destructor.prototype._makeOperation = function (vargs) {
    var operation = vargs.length == 1
                  ? vargs[0]
                  : { object: vargs[1], method: vargs[0] }
    return new Operation(operation)
}

Destructor.prototype.addDestructor = function (name) {
     var operation = this._makeOperation(slice.call(arguments, 1))
    if (this.destroyed) {
        operation.apply([])
    } else {
        this._destructors[name] = operation
    }
}

Destructor.prototype.invokeDestructor = function (name) {
    this._destructors[name].apply([])
    delete this._destructors[name]
}

Destructor.prototype.removeDestructor = function (name) {
    delete this._destructors[name]
}

Destructor.prototype.getDestructors = function () {
    return Object.keys(this._destructors)
}

Destructor.prototype.check = function () {
    if (this.destroyed) {
        throw this._interrupt('destroyed', {}, { cause: coalesce(this.cause) })
    }
}

Destructor.prototype.destructible = cadence(function (async) {
    if (!this.destroyed) {
        var vargs = slice.call(arguments, 1)
        var name = typeof vargs[0] == 'string' ? vargs.shift() : null
        var waiting = { destructible: name }
        this._waiting.push(waiting)
        async([function () {
            this.destroy()
            this._waiting.splice(this._waiting.indexOf(waiting), 1)
            this.events.push({
                module: 'destructible',
                method: 'popped',
                from: this._instance,
                body: {
                    destructor: this._name,
                    destructible: name,
                    waiting: this._waiting.slice(),
                    cause: this.cause
                }
            })
        }], [function () {
            this._makeOperation(vargs).apply([async()])
        }, function (error) {
            if (!this.destroyed) {
                this.destroy(error)
            }
            throw error
        }])
    }
})

Destructor.prototype.async = function (async, name) {
    var destructor = this
    if (destructor.destroyed) {
        return function () {}
    }
    return function () {
        var vargs = slice.call(arguments)
        var waiting = { destructible: name }
        destructor._waiting.push(waiting)
        async([function () {
            destructor.destroy()
            destructor._waiting.splice(destructor._waiting.indexOf(waiting), 1)
            destructor.events.push({
                module: 'destructible',
                method: 'popped',
                from: destructor._instance,
                body: {
                    destructor: destructor._name,
                    destructible: name,
                    waiting: destructor._waiting.slice(),
                    cause: destructor.cause
                }
            })
        }], [function () {
            async.apply(null, vargs)
        }, function (error) {
            if (!destructor.destroyed) {
                destructor.destroy(error)
            }
            throw error
        }])
    }
}

module.exports = Destructor
