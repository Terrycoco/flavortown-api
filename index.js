const express = require('express');
const cors = require("cors");
const app = express();
const db = require("./db.js");
const createError = require('http-errors');

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
    next(err);
  }
});

//all items -- for editor
app.get('/items', (req, res, next) => {
   db.any('select item_id as id, item as name, main_cat_id as cat_id, is_parent, hide_children, cat from items inner join cats on items.main_cat_id = cats.cat_id ORDER BY item;') 
    .then(data => {
      res.send(data);
    })
    .catch(err => {
      next(err);
    })
});

//for editor dropboxes
app.get('/itemsfiltered/:filter', (req, res, next) => {
  const array = JSON.parse(req.params.filter); //convert to array
  console.log('items passed', array, Array.isArray(array));
  const str = array.join(",");
  const sql = "select item_id as id, item as name, is_parent, main_cat_id as cat_id, cat, hide_children from items inner join cats on items.main_cat_id = cats.cat_id WHERE main_cat_id not in(" + str + ") ORDER BY item;"
   console.log('filter sql',sql);
   db.any(sql) 
    .then(data => {
      res.send(data);
    })
    .catch(err => {
       next(err);
    })
});

//all cats
app.get('/cats', (req, res, next) => {
   db.any('select * from cats  ORDER BY cat') 
    .then(data => {
      res.send(data);
    })
    .catch(err => {
       next(err);
    })
});

//get items for one cat (no children) for initial FF
app.get("/itemsbycat/:catId", (req, res, next) => {
  const cat_id = req.params.catId;
  if (cat_id) {
    db.any("select id, name, is_parent, hide_children, cat_id, is_child from items_hide_children where cat_id = $1 order by sorter, name;", [cat_id])
    .then(data => {
      //console.log('data: ', data);
      res.send(data);
    })
    .catch(err => {
        next(err);
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
    .catch(err => {
       next(err);
    })
});

//insert new item
app.post("/upditem", (req, res, next) => {
  console.log(req.body);
  const {id, name, is_parent, cat_id, hide_children} = req.body;
  console.log('editing item: ', id);           
  db.none("UPDATE items set item = $1, main_cat_id = $2, is_parent= $3, hide_children=$4  WHERE item_id = $5", [name, cat_id, is_parent, hide_children, id] )
    .then(() => {
      console.log('item updated:', req.body);
      res.end();
   })
    .catch(err => {
       next(err);
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
      next(err);
    })
});

//insert new pairing - or edit affinity-level
app.post("/pairing/new", (req, res, next) => {
  console.log('adding: ', req.body);
  const {item1_id, item2_id, level=1} = req.body;
  let parent = item1_id;
  let child =item2_id;
  let sql;

    //child  add once
    if (parseInt(level) === 0) {
      sql = "INSERT INTO friends(item_id, friend_id, friend_type) VALUES ($1, $2, $3) ON CONFLICT (item_id, friend_id, friend_type) DO NOTHING";
      db.none(sql, [parent, child, level])
      .then(() => {
           res.end();
        })
    

  //ingredient - add once for ingredient, once where sauce the friend of ingred
    } else if (parseInt(level)===5) {

      sql = "INSERT INTO friends(item_id, friend_id, friend_type) VALUES ($1, $2, $3) ON CONFLICT (item_id, friend_id, friend_type) DO NOTHING";
      db.none(sql, [parent, child, level])
      .then(() => {
        //now add on the ingredient side to link to sauce
        db.none(sql, [child, parent, 7])
        .then(() => {
           res.end();
        })
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
      next(err);
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
      next(err);
   })
});

//mutual friends - FF
app.get("/mutual/:items", (req, res, next) => {
  const array = JSON.parse(req.params.items); //convert to array
  console.log('fetching friends for ', array, Array.isArray(array));
  const arrlen = array.length;
  const sql = `
          select 
          s.main_cat_id as cat_id,
          u.friend_id as id,
          s.sorter,
          s.item as name,
          s.is_parent,
          s.hide_children,
          s.hidden,
          s.is_child,
          min(friend_type) as friend_type
          from union_friends u
          INNER JOIN items_sorter_vw s
          ON s.item_id = u.friend_id
          where (u.item_id = ANY($1))
          group by s.main_cat_id, s.sorter, u.friend_id, s.item, s.is_parent, s.hide_children, s.is_child, s.hidden
          having count(*) = $2
          ORDER BY sorter, name`;
    console.log('sql:', sql);
    db.any(sql, [array, arrlen])
    .then(data => {
     // console.log('data:', data);
      res.send(data);
    })

  // if (!Array.isArray(array) || !array.length) {
  // // array does not exist, is not an array, or is empty
  // // ⇒ do not attempt to process array
  //    sql = sql + groupclause + orderclause;
  //   console.log(sql);
  //  } else {
  //    array.forEach((item, index) => {
  //      whereclause = whereclause + item + ','
  //    })
  //    sql = sql + whereclause.slice(0, -1) + ') ' + groupclause + " HAVING count(*) = " + array.length + orderclause;
  //    console.log(sql);
  //  }
   // db.any(sql)
   //  .then(data => {
   //    //console.log('data: ', data);
   //    res.send(data);
   //  })
    .catch(err => {
      next(err);
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
             throw createError(500, {message: err.message});
          });
      
    } else {
      //do nothing
      res.end();
    }
  })
  .catch(err => {
     throw createError(500, {message: err.message});
  });
  } else {
    //do nothing
    res.end();
  }
});

//ROLLUP to parent
app.post("/updparent", (req, res, next) => {
   const {item_id} = req.body;
   console.log('updating parent', item_id);
   //must have children 0 or ingredients 5
   return db.one("SELECT count(*) as childcount from friends where item_id = $1 and friend_type in (0, 5)", [item_id])
   .then(data => {
      console.log('data:', data.childcount)
      if (data.childcount === '0') {
          let err = new Error('Not a parent');
          err.status = 400;  //bad user request
          next(err); //go to nearest handler
      } else {
        return db.none("CALL sp_update_parent($1)" , [item_id])
          .then(() => {
               res.end();
        })
      }
   })
   .catch( err => {
    console.log('got here');
    next(err);
   })
});

//delete pairing 
app.post("/pairing/delete", (req, res, next) => {
  const {item1_id, item2_id } = req.body;           
  db.none("DELETE from friends WHERE (item_id = $1 AND friend_id = $2) OR (friend_id = $1 AND item_id = $2);", [item1_id, item2_id])
    .then(() => {
      res.end();
   })
    .catch((err) => {
       next(err);
   })
});

//get ALL friends - editor
app.get("/friends/:itemId", (req, res, next) => {
  const item_id = req.params.itemId;
  let sql;
  if (item_id) {
    sql = "select friend_id as id, friend as name, friend_type, friend_is_parent as is_parent from all_friends_vw where item_id = $1 order by friend";
    //console.log(sql);
    db.any(sql, [item_id])
    .then(data => {
     // console.log('data: ', data);
      res.send(data);
    })
    .catch(err => {
        next(err);
    })
}
});

//get ingredients of combo
app.get("/ingreds/:itemId", (req, res, next) => {
  const item_id = req.params.itemId;
  if (item_id) {
    db.any("select friend_id as id, friend as name, friend_type from all_friends_vw where item_id = $1 and friend_type=5 order by friend;", [item_id])
    .then(data => {
      //console.log('data: ', data);
      res.send(data);
    })
    .catch(err => {
     next(err);
    })
}
});


//no route found push to handler
app.use((req, res, next) => {
 const error = new Error("Not found")
 error.status = 404;
 next(error);
});


// error handler middleware
app.use((error, req, res, next) => {
  console.log('caught', error);
  res.status(error.status).json({message: error.message});
});


app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));