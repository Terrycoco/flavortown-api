const express = require('express');
const cors = require("cors");
const app = express();
const db = require("./db.js");

//middleware
app.use(express.json());
app.use(cors());

let PORT = process.env.PORT || 5000;
if (process.env.NODE_ENV == 'development') {
  PORT = 5000; //force
}
 



// tests connection and returns Postgres server version,
// if successful; or else rejects with connection error:
async function testConnection() {
    const c = await db.connect(); // try to connect
    c.done(); // success, release connection
    return c.client.serverVersion; // return server version
}


//ROUTES
app.get('/testdb', async(req, res) => {
    try {
     const testdb = await testConnection()
     res.send(testdb);
  } catch (err) {
    console.error(err.message);
  }
});

//all items
app.get('/items', (req, res, next) => {
   db.any('select item_id as id, item as name, main_cat_id as cat_id, is_parent, cat from items inner join cats on items.main_cat_id = cats.cat_id ORDER BY item;') 
    .then(data => {
      res.send(data);
    })
    .catch(error => {
      console.log('ERROR 44', error);
    })
});

//all items - exclude combos
app.get('/itemsfiltered/:filter', (req, res, next) => {
  const array = JSON.parse(req.params.filter); //convert to array
  console.log('items passed', array, Array.isArray(array));
  const str = array.join(",");
  const sql = "select item_id as id, item as name, is_parent, main_cat_id as cat_id, cat from items inner join cats on items.main_cat_id = cats.cat_id WHERE main_cat_id not in(" + str + ") ORDER BY item;"
   console.log(sql);
   db.any(sql) 
    .then(data => {
      res.send(data);
    })
    .catch(error => {
      console.log('ERROR 44', error);
    })
});

//all cats
app.get('/cats', (req, res, next) => {
   db.any('select * from cats  ORDER BY cat') 
    .then(data => {
      res.send(data);
    })
    .catch(error => {
      console.log('ERROR 55', error);
    })
});

//get items for one cat (no children) for initial FF
app.get("/itemsbycat/:catId", (req, res, next) => {
  const cat_id = req.params.catId;
  if (cat_id) {
    db.any("select id, name, is_parent, cat_id from items_no_children where cat_id = $1 order by name;", [cat_id])
    .then(data => {
      //console.log('data: ', data);
      res.send(data);
    })
    .catch(error => {
       //TODO: better error handling - how to send error to user?
        console.error('ERROR 103', error.detail);
        res.send(error.detail);
    })
}
});

//insert new item
app.post("/items/new", (req, res, next) => {
  const {item, cat_id} = req.body; 
  console.log('addding item: ', item, 'cat_id:', cat_id);            
  db.one("INSERT INTO items (item, main_cat_id) VALUES ($1, $2) RETURNING item_id as id, item as name, main_cat_id as cat_id", [item, cat_id])
    .then(data => {
      console.log('item added:', data);
      res.send(data);
   })
    .catch(error => {
      //TODO: better error handling - how to send error to user?
      console.error('ERROR 70 trying to insert item:', req.body, error.detail);
      res.send(error.detail);
    })
});

//insert new item
app.post("/item/edit", (req, res, next) => {
  const {item_id, cat_id, item} = req.body; 
  console.log('editing item: ', item, 'cat_id:', cat_id);            
  db.none("UPDATE items set item = $1, main_cat_id = $2 WHERE item_id = $3", [item, cat_id, item_id] )
    .then(() => {
      console.log('item updated:', req.body);
      res.end();
   })
    .catch(err => {
      //TODO: better error handling - how to send error to user?
      console.error('ERROR 105 trying to update item:', req.body, err.message);
      res.send(err.message);
    })
});

//delete item
app.post("/item/delete", (req, res, next) => {
  const {item_id} = req.body; 
  console.log('deleting item: ', item_id);            
  db.none("DELETE from items WHERE item_id = $1", [ item_id] )
    .then(() => {
      console.log('item deleted:', req.body);
      res.end();
   })
    .catch(err => {
      //TODO: better error handling - how to send error to user?
      console.error('ERROR 121 trying to update item:', req.body, err.message);
      res.error(err.message);
    })
});

//insert new pairing - or edit affinity-level
app.post("/pairing/new", (req, res, next) => {
  console.log('adding: ', req.body);
  const {item1_id, item2_id, level=1} = req.body;
  let sql;

  //child - only add once
    if (parseInt(level) === 0) {
      let parent = item1_id;
      let child =item2_id;
      sql = "INSERT INTO friends(item_id, friend_id, friend_type) VALUES ($1, $2, 0) ON CONFLICT (item_id, friend_id) DO NOTHING";
      db.none(sql, [parent, child])
      .then(() => {
        db.none("UPDATE items SET is_parent = true where item_id = $1", [parent])
      })
      .then(() => {
        console.log('child added');
        res.end();
      })

  //not parent child (must add twice)
  } else {   
    sql = "INSERT INTO friends(item_id, friend_id, friend_type) VALUES ($1, $2, $3) ON CONFLICT  (item_id, friend_id) DO UPDATE set friend_type = $3";
    db.none(sql, [item1_id, item2_id, level])
    .then(() => {
      db.none(sql, [item2_id, item1_id, level])
      .then(() => {
        console.log('pairing added');
        res.end();
       })
    })
    .catch((err) => {
      console.error('ERROR 154', err.message);
      res.end();
    })
  }//end if
});

app.post("/merge", (req, res, next) => {
   const {keep, lose} = req.body;
   db.none("CALL sp_merge_items($1, $2)", [keep, lose])
   .then(() => {
      res.end();
   })
   .catch( err => {
      console.error(err.message);
   })
});

//update a combo to make sure all ingredients
//go with eachother as friends
app.get("/updcombo/:itemId" , (req, res, next) => {
  const item_id = req.params.itemId;
 
  if (item_id) {
    db.any("select friend_id as id from all_friends_vw where item_id = $1 and item_cat_id = 12 and friend_type = 5", [item_id])
    .then(ingreds => {

    if (ingreds.length > 1) {
       let i;
       let inner;
       let sql = "INSERT into friends (item_id, friend_id) VALUES ";


       for (i=0; i < ingreds.length - 1; i++) {

        //console.log(' i is:', i);

           for (inner=i+1; inner < ingreds.length; inner++) {

            // double insert both item and friend
              sql = sql + "(" + ingreds[i].id + "," + ingreds[inner].id + "),";
              sql = sql + "(" + ingreds[inner].id + "," + ingreds[i].id + "),";
           }
        }

        
         //removelast comma
         sql = sql.slice(0, -1);


         sql = sql + ' ON CONFLICT (item_id, friend_id) DO NOTHING';
          console.log('ending sql', sql);

          return db.any(sql)
          .then(() => {
            console.log('done')
            res.send('done');
            return;
          })
          .catch(err => {
            console.error(err.detail);
          });
      
    } else {
      //do nothing
      res.end();
    }
  })
  .catch(err => {
     res.send(err.detail);
  });
  } else {
    //do nothing
    res.end();
  }
});

app.post("/updparent", (req, res, next) => {
   const {item_id} = req.body;
   db.none("CALL sp_update_parent($1)" , [item_id])
   .then(() => {
      res.end();
   })
   .catch( err => {
    console.error(err.message)
   })
});

//delete pairing 
app.post("/pairing/delete", (req, res, next) => {
  const {item1_id, item2_id } = req.body;           
  db.none("DELETE from friends WHERE (item_id = $1 AND friend_id = $2) OR (friend_id = $1 AND item_id = $2);", [item1_id, item2_id])
    .then(() => {
      res.end();
   })
    .catch((error) => {
       //fallback
        console.error('ERROR 88', error.detail);
        res.end();
   })
});

//get friends - editor
app.get("/friends/:itemId", (req, res, next) => {
  const item_id = req.params.itemId;
  let sql;
  if (item_id) {
    sql = "select friend_id as id, friend as name, friend_type, friend_is_parent as is_parent from all_friends_vw where item_id = $1 order by friend";
    console.log(sql);
    db.any(sql, [item_id])
    .then(data => {
      console.log('data: ', data);
      res.send(data);
    })
    .catch(error => {
       //TODO: better error handling - how to send error to user?
        console.error('ERROR 103', error.detail);
        res.send(error.detail);
    })
}
});

//get ingredients of combo
app.get("/ingreds/:itemId", (req, res, next) => {
  const item_id = req.params.itemId;
  if (item_id) {
    db.any("select friend_id as id, friend as name, friend_type from all_friends_vw where item_id = $1 and affinity_level=5 order by friend;", [item_id])
    .then(data => {
      //console.log('data: ', data);
      res.send(data);
    })
    .catch(error => {
       //TODO: better error handling - how to send error to user?
        console.error('ERROR 103', error.detail);
        res.send(error.detail);
    })
}
});

//mutual friends - FF
app.get("/mutual/:items", (req, res, next) => {
  const array = JSON.parse(req.params.items); //convert to array
  console.log('items passed', array, Array.isArray(array));

  let sql = `select friend_id as id, friend as name, friend_cat as cat, friend_cat_id as cat_id, min(friend_type) as friend_type, friend_is_parent as is_parent from friends_with_cats_vw`;
  let whereclause = ' WHERE item_id IN(';
  let groupclause = " GROUP BY friend_cat, friend_cat_id, friend_id, friend, friend_is_parent ";
  let orderclause = " ORDER BY friend_cat, friend ";

  if (!Array.isArray(array) || !array.length) {
  // array does not exist, is not an array, or is empty
  // ⇒ do not attempt to process array
     sql = sql + groupclause + orderclause;
    console.log(sql);
   } else {
     array.forEach((item, index) => {
       whereclause = whereclause + item + ','
     })
     sql = sql + whereclause.slice(0, -1) + ') ' + groupclause + " HAVING count(*) = " + array.length + orderclause;
     console.log(sql);
   }
   db.any(sql)
    .then(data => {
      //console.log('data: ', data);
      res.send(data);
    })
    .catch(err => {
       //TODO: better error handling - how to send error to user?
        console.error('ERROR 331', err.message);
        res.send(err.message);
    })
});


app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));