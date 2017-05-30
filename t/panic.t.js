require('proof')(1, prove)

function prove (assert) {
    var panic = require('../panic')
    var panicIf = panic.createPanicIf(function (f) { f() })

    panicIf(false)

    try {
        panicIf(true, 'hung', { key: 'value' }, {})
    } catch (error) {
        console.log(error.stack)
        assert(/^destructible#hung$/m.test(error.message), 'panicked')
    }
}
