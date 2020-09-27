async function main () {
    const Destructbile = require('..')
    {
        const destructible = new Destructbile('quickly')
        destructible.destroy()
        await destructible.rejected
    }
    console.log('okay')
    {
        const destructible = new Destructbile('awaited')
        console.log('--- xxx ---')
        destructible.ephemeral('setup', Destructbile.rescue(async function () {
            destructible.ephemeral('config', async function () {
                throw new Error
            })
            await new Promise(resolve => setImmediate(resolve))
            destructible.ephemeral('config', async function () {
                throw new Error
            })
        }))
        console.log('--- xx! ---')
        try {
            await destructible.rejected
        } catch (error) {
            console.log(error.stack)
        }
    }
    {
        const destructible = new Destructbile('awaited')
        console.log('--- xxx ---')
        destructible.rescue('initialize', async function () {
            destructible.ephemeral('config', async function () {
                throw new Error
            })
            await new Promise(resolve => setImmediate(resolve))
            destructible.ephemeral('config', async function () {
                throw new Error
            })
        })
        console.log('--- xx2 ---')
        try {
            await destructible.rejected
        } catch (error) {
            console.log(error.stack)
        }
    }
    {
        const destructible = new Destructbile('awaited')
        console.log('--- xxx ---')
        destructible.rescue('initialize', async function () {
            destructible.ephemeral('config', async function () {
                throw new Error
            })
            throw new Error
        })
        console.log('--- xx2 ---')
        try {
            await destructible.rejected
        } catch (error) {
            console.log(error.stack)
        }
    }
    console.log('next')
    {
        const destructible = new Destructbile('awaited')
        console.log('--- xxx ---')
        Destructbile.rescue(async function () {
            await destructible.ephemeral('config', async function () {
                throw new Error
            })
            await new Promise(resolve => setTimeout(resolve, 500))
            throw new Error
            await destructible.ephemeral('config 2', async function () {
            })
        })
        console.log('--- xx! ---')
        try {
            await destructible.rejected
        } catch (error) {
            console.log(error.stack)
        }
    }
}

main()
