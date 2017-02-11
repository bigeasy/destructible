require('proof/redux')(8, require('cadence')(prove))

function prove (async, assert) {
    var Destructor = require('..')
    var destructor = new Destructor

    var object = { destroyed: false }

    destructor.markDestroyed(object, 'destroyed')
    destructor.addDestructor('destructor', function () {
        assert(true, 'destructor ran')
    })
    destructor.addDestructor('invoked', function () {
        assert(true, 'destructor invoked')
    })
    destructor.addDestructor('removed', function () {
        throw new Error('should not run')
    })
    destructor.invokeDestructor('invoked')
    destructor.removeDestructor('removed')
    assert(destructor.getDestructors(), [ 'destructor' ], 'removed')

    destructor.check()

    async([function () {
        destructor.destructable(function (callback) {
            destructor.destructable(function (callback) {
                callback(new Error('cause'))
            }, callback)
        }, async())
    }, function (error) {
        assert(error.message, 'cause', 'error thrown')
        assert(destructor.destroyed, true, 'destroyed')
        assert(object.destroyed, true, 'marked destroyed')

        try {
            destructor.check()
        } catch (error) {
            console.log(error.stack)
            assert(/^nascent.destructor#destroyed$/m.test(error.message), 'destroyed')
        }

        destructor.destroy()

        destructor.addDestructor('destroyed', function () {
            assert(true, 'run after destroyed')
        })

        destructor.destructable(function () {
            assert(false, 'should not be called')
        }, async())
    }])
}
