!function (a, b) {
  "object" == typeof exports && "object" == typeof module ? module.exports = b() : "function" == typeof define && define.amd ? define([], b) : "object" == typeof exports ? exports.CB3Libs = b() : a.CB3Libs = b()
}(this, function () {
  return function () {
    function a(d) {
      var e = c[d];
      if (void 0 !== e)
        return e.exports;
      var f = c[d] = {
        exports: {}
      };
      return b[d](f, f.exports, a),
        f.exports
    }
    var b = {}
      , c = {};
    a.d = function (b, c) {
      for (var d in c)
        a.o(c, d) && !a.o(b, d) && Object.defineProperty(b, d, {
          enumerable: !0,
          get: c[d]
        })
    };
    a.o = function (a, b) {
      return Object.prototype.hasOwnProperty.call(a, b)
    };
    a.r = function (a) {
      "undefined" != typeof Symbol && Symbol.toStringTag && Object.defineProperty(a, Symbol.toStringTag, {
        value: "Module"
      }),
        Object.defineProperty(a, "__esModule", {
          value: !0
        })
    };
    var d = {};
    !function () {
      function register(a) {
        biomeList[a.id] = a;
        null != a.parent && (m[a.parent] = a.id);
        return a
      }
      a.r(d);
      a.d(d, {
        BedrockVersion: function () {
          return beVersions
        },
        Dimension: function () {
          return dimensions
        },
        DungeonType: function () {
          return dungeonTypes
        },
        Edition: function () {
          return editions
        },
        JavaVersion: function () {
          return jeVersions
        },
        Long: function () {
          return dcodeIO.Long
        },
        POI: function () {
          return poiTypes
        },
        biomeList: function () {
          return biomeList
        },
        supportsCaveBiomes: function () {
          return supportsCaveBiomes
        }
      });
      var editions, jeVersions, beVersions, dimensions, dungeonTypes, poiTypes;
      !function (a) {
        a.Java = "Java";
        a.Bedrock = "Bedrock";
      }(editions || (editions = {}));
      !function (a) {
        a[a.V1_7 = 100700] = "V1_7";
        a[a.V1_8 = 100800] = "V1_8";
        a[a.V1_9 = 100900] = "V1_9";
        a[a.V1_10 = 101000] = "V1_10";
        a[a.V1_11 = 101100] = "V1_11";
        a[a.V1_12 = 101200] = "V1_12";
        a[a.V1_13 = 101300] = "V1_13";
        a[a.V1_14 = 101400] = "V1_14";
        a[a.V1_15 = 101500] = "V1_15";
        a[a.V1_16 = 101600] = "V1_16";
        a[a.V1_17 = 101700] = "V1_17";
        a[a.V1_18 = 101800] = "V1_18";
        a[a.V1_19 = 101900] = "V1_19";
        a[a.V1_19_3 = 101903] = "V1_19_3";
        a[a.V1_20 = 102000] = "V1_20";
        a[a.V1_21 = 102100] = "V1_21";
        a[a.V1_21_2 = 102102] = "V1_21_2";
        a[a.V1_21_4 = 102104] = "V1_21_4";
        a[a.V1_21_5 = 102105] = "V1_21_5";
        a[a.V1_21_6 = 102106] = "V1_21_6";
        a[a.V1_21_9 = 102109] = "V1_21_9";
        a[a.V26_2 = 260200] = "V26_2";
        a[a.V26_3 = 260300] = "V26_3";
      }(jeVersions || (jeVersions = {}));
      !function (a) {
        a[a.V1_14 = 101400] = "V1_14";
        a[a.V1_16 = 101600] = "V1_16";
        a[a.V1_17 = 101700] = "V1_17";
        a[a.V1_18 = 101800] = "V1_18";
        a[a.V1_19 = 101900] = "V1_19";
        a[a.V1_20 = 102000] = "V1_20";
        a[a.V_1_20_60 = 102006] = "V_1_20_60";
        a[a.V1_21 = 102100] = "V1_21";
        a[a.V1_21_40 = 102104] = "V1_21_40";
        a[a.V1_21_50 = 102105] = "V1_21_50";
        a[a.V1_21_60 = 102106] = "V1_21_60";
        a[a.V1_21_70 = 102107] = "V1_21_70";
        a[a.V1_21_80 = 102108] = "V1_21_80";
        a[a.V1_21_90 = 102109] = "V1_21_90";
        a[a.V1_21_110 = 102111] = "V1_21_110";
        a[a.V1_21_120 = 102112] = "V1_21_120";
        a[a.V26_30 = 263000] = "V26_30";
        a[a.V26_40 = 264000] = "V26_40";
      }(beVersions || (beVersions = {}));
      !function (a) {
        a.Overworld = "overworld";
        a.Nether = "nether";
        a.End = "end";
      }(dimensions || (dimensions = {}));
      !function (a) {
        a[a.ZOMBIE = 0] = "ZOMBIE";
        a[a.SPIDER = 1] = "SPIDER";
        a[a.SKELETON = 2] = "SKELETON";
      }(dungeonTypes || (dungeonTypes = {}));
      !function (a) {
        a.BastionRemnant = "bastionRemnant";
        a.BuriedTreasure = "buriedTreasure";
        a.Dungeon = "dungeon";
        a.EndCity = "endCity";
        a.NetherFortress = "netherFortress";
        a.SlimeChunk = "slimeChunk";
        a.Stronghold = "stronghold";
        a.Village = "village";
        a.Mineshaft = "mineshaft";
        a.WoodlandMansion = "woodlandMansion";
        a.PillagerOutpost = "pillagerOutpost";
        a.OceanRuin = "oceanRuin";
        a.OceanMonument = "oceanMonument";
        a.Shipwreck = "shipwreck";
        a.DesertTemple = "desertTemple";
        a.JungleTemple = "jungleTemple";
        a.WitchHut = "witchHut";
        a.Igloo = "igloo";
        a.RuinedPortalOverworld = "ruinedPortalOverworld";
        a.RuinedPortalNether = "ruinedPortalNether";
        a.Spawn = "spawn";
        a.Fossil = "fossil";
        a.Ravine = "ravine";
        a.EndGateway = "endGateway";
        a.AmethystGeode = "amethystGeode";
        a.AncientCity = "ancientCity";
        a.ItemOverworld = "itemOverworld";
        a.OreVein = "oreVein";
        a.Cave = "cave";
        a.DesertWell = "desertWell";
        a.TrailRuin = "trailRuin";
        a.TrialChamber = "trialChamber";
        a.LavaPool = "lavaPool";
        a.HTCustomize = "htCustomize";
      }(poiTypes || (poiTypes = {}));
      var supportsCaveBiomes = function (a) {
        return function (a) {
          return a.edition === editions.Java && a.javaVersion >= jeVersions.V1_18 || a.edition === editions.Bedrock && a.bedrockVersion >= beVersions.V1_18
        }(a)
      }
        , biomeList = []
        , m = {}
        , n = (register({
          id: 0,
          key: "ocean",
          name: "海洋",
          category: "ocean",
          temperature: .5,
          precipitation: "rain",
          depth: -1,
          rgb: [0, 0, 112],
          dimension: dimensions.Overworld
        }),
          register({
            id: 1,
            key: "plains",
            name: "平原",
            category: "plains",
            temperature: .8,
            precipitation: "rain",
            depth: .125,
            rgb: [141, 179, 96],
            dimension: dimensions.Overworld
          }))
        , o = register({
          id: 2,
          key: "desert",
          name: "沙漠",
          category: "desert",
          temperature: 2,
          precipitation: "none",
          depth: .125,
          rgb: [250, 148, 24],
          dimension: dimensions.Overworld
        })
        , p = register({
          id: 3,
          key: "windswept_hills",
          name: "风袭丘陵",
          oldNames: ["山地"],
          category: "extreme_hills",
          temperature: .2,
          precipitation: "rain",
          depth: 1,
          rgb: [96, 96, 96],
          dimension: dimensions.Overworld
        })
        , q = register({
          id: 4,
          key: "forest",
          name: "森林",
          category: "forest",
          temperature: .7,
          precipitation: "rain",
          depth: .1,
          rgb: [5, 102, 33],
          dimension: dimensions.Overworld
        })
        , r = register({
          id: 5,
          key: "taiga",
          name: "针叶林",
          category: "taiga",
          temperature: .25,
          precipitation: "rain",
          depth: .2,
          rgb: [11, 102, 89],
          dimension: dimensions.Overworld
        })
        , s = register({
          id: 6,
          key: "swamp",
          name: "沼泽",
          category: "swamp",
          temperature: .8,
          precipitation: "rain",
          depth: -.2,
          rgb: [7, 249, 178],
          dimension: dimensions.Overworld
        })
        , t = (register({
          id: 7,
          key: "river",
          name: "河流",
          category: "river",
          temperature: .5,
          precipitation: "rain",
          depth: -.5,
          rgb: [0, 0, 255],
          dimension: dimensions.Overworld
        }),
          register({
            id: 8,
            key: "nether_wastes",
            name: "下界荒地",
            category: "nether",
            temperature: 2,
            precipitation: "none",
            depth: .1,
            rgb: [191, 59, 59],
            climates: [{
              temperature: 0,
              humidity: 0,
              altitude: 0,
              weirdness: 0,
              offset: 0
            }],
            dimension: dimensions.Nether
          }),
          register({
            id: 9,
            key: "the_end",
            name: "末地",
            category: "the_end",
            temperature: .5,
            precipitation: "none",
            depth: .1,
            rgb: [128, 128, 255],
            dimension: dimensions.End
          }),
          register({
            id: 10,
            key: "frozen_ocean",
            name: "冻洋",
            category: "ocean",
            temperature: 0,
            precipitation: "snow",
            depth: -1,
            rgb: [112, 112, 214],
            dimension: dimensions.Overworld
          }),
          register({
            id: 11,
            key: "frozen_river",
            name: "冻河",
            category: "river",
            temperature: 0,
            precipitation: "snow",
            depth: -.5,
            rgb: [160, 160, 255],
            dimension: dimensions.Overworld
          }),
          register({
            id: 12,
            key: "snowy_plains",
            name: "雪原",
            oldNames: ["积雪的冻原"],
            category: "icy",
            temperature: 0,
            precipitation: "snow",
            depth: .125,
            rgb: [255, 255, 255],
            dimension: dimensions.Overworld
          }))
        , u = (register({
          id: 13,
          name: "雪山",
          category: "icy",
          temperature: 0,
          precipitation: "snow",
          depth: .45,
          rgb: [160, 160, 160],
          dimension: dimensions.Overworld
        }),
          register({
            id: 14,
            key: "mushroom_fields",
            name: "蘑菇岛",
            category: "mushroom",
            temperature: .9,
            precipitation: "rain",
            depth: .2,
            rgb: [255, 0, 255],
            dimension: dimensions.Overworld
          }),
          register({
            id: 15,
            name: "蘑菇岛岸",
            category: "mushroom",
            temperature: .9,
            precipitation: "rain",
            depth: 0,
            rgb: [160, 0, 255],
            dimension: dimensions.Overworld
          }),
          register({
            id: 16,
            key: "beach",
            name: "沙滩",
            category: "beach",
            temperature: .8,
            precipitation: "rain",
            depth: 0,
            rgb: [250, 222, 85],
            dimension: dimensions.Overworld
          }),
          register({
            id: 17,
            name: "沙漠丘陵",
            category: "desert",
            temperature: 2,
            precipitation: "none",
            depth: .45,
            rgb: [210, 95, 18],
            dimension: dimensions.Overworld
          }),
          register({
            id: 18,
            key: "windswept_forest",
            name: "风袭森林",
            oldNames: ["繁茂的丘陵"],
            category: "forest",
            temperature: .7,
            precipitation: "rain",
            depth: .45,
            rgb: [34, 85, 28],
            dimension: dimensions.Overworld
          }),
          register({
            id: 19,
            name: "针叶林丘陵",
            category: "taiga",
            temperature: .25,
            precipitation: "rain",
            depth: .45,
            rgb: [22, 57, 51],
            dimension: dimensions.Overworld
          }),
          register({
            id: 20,
            name: "山地边缘",
            category: "extreme_hills",
            temperature: .2,
            precipitation: "rain",
            depth: .8,
            rgb: [114, 120, 154],
            dimension: dimensions.Overworld
          }),
          register({
            id: 21,
            key: "jungle",
            name: "丛林",
            category: "jungle",
            temperature: .95,
            precipitation: "rain",
            depth: .1,
            rgb: [83, 123, 9],
            dimension: dimensions.Overworld
          }))
        , v = (register({
          id: 22,
          name: "丛林丘陵",
          category: "jungle",
          temperature: .95,
          precipitation: "rain",
          depth: .45,
          rgb: [44, 66, 5],
          dimension: dimensions.Overworld
        }),
          register({
            id: 23,
            key: "sparse_jungle",
            name: "稀疏丛林",
            oldNames: ["丛林边缘"],
            category: "jungle",
            temperature: .95,
            precipitation: "rain",
            depth: .1,
            rgb: [98, 139, 23],
            dimension: dimensions.Overworld
          }))
        , w = (register({
          id: 24,
          key: "deep_ocean",
          name: "深海",
          category: "ocean",
          temperature: .5,
          precipitation: "rain",
          depth: -1.8,
          rgb: [0, 0, 48],
          dimension: dimensions.Overworld
        }),
          register({
            id: 25,
            key: "stony_shore",
            name: "石岸",
            oldNames: ["石岸"],
            category: "none",
            temperature: .2,
            precipitation: "rain",
            depth: .1,
            rgb: [162, 162, 132],
            dimension: dimensions.Overworld
          }),
          register({
            id: 26,
            key: "snowy_beach",
            name: "积雪沙滩",
            category: "beach",
            temperature: .05,
            precipitation: "snow",
            depth: 0,
            rgb: [250, 240, 192],
            dimension: dimensions.Overworld
          }),
          register({
            id: 27,
            key: "birch_forest",
            name: "桦木森林",
            category: "forest",
            temperature: .6,
            precipitation: "rain",
            depth: .1,
            rgb: [48, 116, 68],
            dimension: dimensions.Overworld
          }))
        , x = register({
          id: 28,
          name: "桦木森林丘陵",
          category: "forest",
          temperature: .6,
          precipitation: "rain",
          depth: .45,
          rgb: [31, 95, 50],
          dimension: dimensions.Overworld
        })
        , y = register({
          id: 29,
          key: "dark_forest",
          name: "黑森林",
          category: "forest",
          temperature: .7,
          precipitation: "rain",
          depth: .1,
          rgb: [64, 81, 26],
          dimension: dimensions.Overworld
        })
        , z = register({
          id: 30,
          key: "snowy_taiga",
          name: "积雪针叶林",
          category: "taiga",
          temperature: -.5,
          precipitation: "snow",
          depth: .2,
          rgb: [49, 85, 74],
          dimension: dimensions.Overworld
        })
        , A = (register({
          id: 31,
          name: "积雪的针叶林丘陵",
          category: "taiga",
          temperature: -.5,
          precipitation: "snow",
          depth: .45,
          rgb: [36, 63, 54],
          dimension: dimensions.Overworld
        }),
          register({
            id: 32,
            key: "old_growth_pine_taiga",
            name: "原始松木针叶林",
            oldNames: ["巨型针叶林"],
            category: "taiga",
            temperature: .3,
            precipitation: "rain",
            depth: .2,
            rgb: [89, 102, 81],
            dimension: dimensions.Overworld
          }))
        , B = register({
          id: 33,
          name: "巨型针叶林丘陵",
          category: "taiga",
          temperature: .3,
          precipitation: "rain",
          depth: .45,
          rgb: [69, 79, 62],
          dimension: dimensions.Overworld
        })
        , C = register({
          id: 34,
          name: "繁茂的山地",
          category: "extreme_hills",
          temperature: .2,
          precipitation: "rain",
          depth: 1,
          rgb: [80, 112, 80],
          dimension: dimensions.Overworld
        })
        , D = register({
          id: 35,
          key: "savanna",
          name: "热带草原",
          category: "savanna",
          temperature: 1.2,
          precipitation: "none",
          depth: .125,
          rgb: [189, 178, 95],
          dimension: dimensions.Overworld
        })
        , E = register({
          id: 36,
          key: "savanna_plateau",
          name: "热带高原",
          category: "savanna",
          temperature: 1,
          precipitation: "none",
          depth: 1.5,
          rgb: [167, 157, 100],
          dimension: dimensions.Overworld
        })
        , F = register({
          id: 37,
          key: "badlands",
          name: "恶地",
          category: "mesa",
          temperature: 2,
          precipitation: "none",
          depth: .1,
          rgb: [217, 69, 21],
          dimension: dimensions.Overworld
        })
        , G = register({
          id: 38,
          key: "wooded_badlands",
          name: "疏林恶地",
          oldNames: ["繁茂的恶地高原"],
          category: "mesa",
          temperature: 2,
          precipitation: "none",
          depth: 1.5,
          rgb: [176, 151, 101],
          dimension: dimensions.Overworld
        })
        , H = register({
          id: 39,
          name: "恶地高原",
          category: "mesa",
          temperature: 2,
          precipitation: "none",
          depth: 1.5,
          rgb: [202, 140, 101],
          dimension: dimensions.Overworld
        });
      register({
        id: 40,
        key: "small_end_islands",
        name: "末地小型岛屿",
        category: "the_end",
        temperature: .5,
        precipitation: "none",
        depth: .1,
        rgb: [0, 0, 42],
        dimension: dimensions.End
      });
      register({
        id: 41,
        key: "end_midlands",
        name: "末地内陆",
        category: "the_end",
        temperature: .5,
        precipitation: "none",
        depth: .1,
        rgb: [235, 248, 182],
        dimension: dimensions.End
      });
      register({
        id: 42,
        key: "end_highlands",
        name: "末地高地",
        category: "the_end",
        temperature: .5,
        precipitation: "none",
        depth: .1,
        rgb: [195, 189, 137],
        dimension: dimensions.End
      });
      register({
        id: 43,
        key: "end_barrens",
        name: "末地荒地",
        category: "the_end",
        temperature: .5,
        precipitation: "none",
        depth: .1,
        rgb: [144, 144, 114],
        dimension: dimensions.End
      });
      register({
        id: 44,
        key: "warm_ocean",
        name: "暖水海洋",
        category: "ocean",
        temperature: .5,
        precipitation: "rain",
        depth: -1,
        rgb: [0, 0, 172],
        dimension: dimensions.Overworld
      });
      register({
        id: 45,
        key: "lukewarm_ocean",
        name: "温水海洋",
        category: "ocean",
        temperature: .5,
        precipitation: "rain",
        depth: -1,
        rgb: [0, 0, 144],
        dimension: dimensions.Overworld
      });
      register({
        id: 46,
        key: "cold_ocean",
        name: "冷水海洋",
        category: "ocean",
        temperature: .5,
        precipitation: "rain",
        depth: -1,
        rgb: [32, 32, 112],
        dimension: dimensions.Overworld
      });
      register({
        id: 47,
        key: "deep_warm_ocean",
        name: "暖水深海",
        category: "ocean",
        temperature: .5,
        precipitation: "rain",
        depth: -1.8,
        rgb: [0, 0, 80],
        dimension: dimensions.Overworld
      });
      register({
        id: 48,
        key: "deep_lukewarm_ocean",
        name: "温水深海",
        category: "ocean",
        temperature: .5,
        precipitation: "rain",
        depth: -1.8,
        rgb: [0, 0, 64],
        dimension: dimensions.Overworld
      });
      register({
        id: 49,
        key: "deep_cold_ocean",
        name: "冷水深海",
        category: "ocean",
        temperature: .5,
        precipitation: "rain",
        depth: -1.8,
        rgb: [32, 32, 56],
        dimension: dimensions.Overworld
      });
      register({
        id: 50,
        key: "deep_frozen_ocean",
        name: "冰冻深海",
        category: "ocean",
        temperature: .5,
        precipitation: "rain",
        depth: -1.8,
        rgb: [64, 64, 144],
        dimension: dimensions.Overworld
      });
      register({
        id: 129,
        name: "向日葵平原",
        key: "sunflower_plains",
        category: "plains",
        temperature: .8,
        precipitation: "rain",
        depth: .125,
        rgb: [181, 219, 136],
        parent: n.id,
        dimension: dimensions.Overworld
      });
      register({
        id: 130,
        name: "沙漠湖泊",
        category: "desert",
        temperature: 2,
        precipitation: "none",
        depth: .125,
        rgb: [255, 188, 64],
        parent: o.id,
        dimension: dimensions.Overworld
      });
      register({
        id: 131,
        key: "windswept_gravelly_hills",
        name: "风袭沙砾丘陵",
        oldNames: ["沙砾山地"],
        category: "extreme_hills",
        temperature: .2,
        precipitation: "rain",
        depth: 1,
        rgb: [136, 136, 136],
        parent: p.id,
        dimension: dimensions.Overworld
      });
      register({
        id: 132,
        key: "flower_forest",
        name: "繁花森林",
        category: "forest",
        temperature: .7,
        precipitation: "rain",
        depth: .1,
        rgb: [45, 142, 73],
        parent: q.id,
        dimension: dimensions.Overworld
      });
      register({
        id: 133,
        name: "针叶林山地",
        category: "taiga",
        temperature: .25,
        precipitation: "rain",
        depth: .3,
        rgb: [51, 142, 129],
        parent: r.id,
        dimension: dimensions.Overworld
      });
      register({
        id: 134,
        name: "沼泽丘陵",
        category: "swamp",
        temperature: .8,
        precipitation: "rain",
        depth: -.1,
        rgb: [47, 255, 218],
        parent: s.id,
        dimension: dimensions.Overworld
      });
      register({
        id: 140,
        key: "ice_spikes",
        name: "冰刺之地",
        category: "icy",
        temperature: 0,
        precipitation: "snow",
        depth: .425,
        rgb: [180, 220, 220],
        parent: t.id,
        dimension: dimensions.Overworld
      });
      register({
        id: 149,
        name: "丛林变种",
        category: "jungle",
        temperature: .95,
        precipitation: "rain",
        depth: .2,
        rgb: [123, 163, 49],
        parent: u.id,
        dimension: dimensions.Overworld
      });
      register({
        id: 151,
        name: "丛林边缘变种",
        category: "jungle",
        temperature: .95,
        precipitation: "rain",
        depth: .2,
        rgb: [138, 179, 63],
        parent: v.id,
        dimension: dimensions.Overworld
      });
      register({
        id: 155,
        key: "old_growth_birch_forest",
        name: "原始桦木森林",
        oldNames: ["高大桦木森林"],
        category: "forest",
        temperature: .6,
        precipitation: "rain",
        depth: .2,
        rgb: [88, 156, 108],
        parent: w.id,
        dimension: dimensions.Overworld
      });
      register({
        id: 156,
        name: "高大桦木丘陵",
        category: "forest",
        temperature: .6,
        precipitation: "rain",
        depth: .55,
        rgb: [71, 135, 90],
        parent: x.id,
        dimension: dimensions.Overworld
      });
      register({
        id: 157,
        name: "黑森林丘陵",
        category: "forest",
        temperature: .7,
        precipitation: "rain",
        depth: .2,
        rgb: [104, 121, 66],
        parent: y.id,
        dimension: dimensions.Overworld
      });
      register({
        id: 158,
        name: "积雪的针叶林山地",
        category: "taiga",
        temperature: -.5,
        precipitation: "snow",
        depth: .3,
        rgb: [89, 125, 114],
        parent: z.id,
        dimension: dimensions.Overworld
      });
      register({
        id: 160,
        key: "old_growth_spruce_taiga",
        name: "原始云杉针叶林",
        oldNames: ["巨型云杉针叶林"],
        category: "taiga",
        temperature: .25,
        precipitation: "rain",
        depth: .2,
        rgb: [129, 142, 121],
        parent: A.id,
        dimension: dimensions.Overworld
      });
      register({
        id: 161,
        name: "巨型云杉针叶林丘陵",
        category: "taiga",
        temperature: .25,
        precipitation: "rain",
        depth: .2,
        rgb: [109, 119, 102],
        parent: B.id,
        dimension: dimensions.Overworld
      });
      register({
        id: 162,
        name: "沙砾山地+",
        category: "extreme_hills",
        temperature: .2,
        precipitation: "rain",
        depth: 1,
        rgb: [120, 152, 120],
        parent: C.id,
        dimension: dimensions.Overworld
      });
      register({
        id: 163,
        key: "windswept_savanna",
        name: "风袭热带草原",
        oldNames: ["破碎的热带草原"],
        category: "savanna",
        temperature: 1.1,
        precipitation: "none",
        depth: .3625,
        rgb: [229, 218, 135],
        parent: D.id,
        dimension: dimensions.Overworld
      });
      register({
        id: 164,
        name: "破碎的热带高原",
        category: "savanna",
        temperature: 1,
        precipitation: "none",
        rgb: [207, 197, 140],
        depth: 1.05,
        parent: E.id,
        dimension: dimensions.Overworld
      });
      register({
        id: 165,
        key: "eroded_badlands",
        name: "风蚀恶地",
        category: "mesa",
        temperature: 2,
        precipitation: "none",
        depth: .1,
        rgb: [255, 109, 61],
        parent: F.id,
        dimension: dimensions.Overworld
      });
      register({
        id: 166,
        name: "繁茂的恶地高原变种",
        category: "mesa",
        temperature: 2,
        precipitation: "none",
        depth: .45,
        rgb: [216, 191, 141],
        parent: G.id,
        dimension: dimensions.Overworld
      });
      register({
        id: 167,
        name: "恶地高原变种",
        category: "mesa",
        temperature: 2,
        precipitation: "none",
        depth: .45,
        rgb: [242, 180, 141],
        parent: H.id,
        dimension: dimensions.Overworld
      });
      register({
        id: 168,
        key: "bamboo_jungle",
        name: "竹林",
        category: "jungle",
        temperature: .95,
        precipitation: "rain",
        depth: .1,
        rgb: [118, 142, 20],
        dimension: dimensions.Overworld
      });
      register({
        id: 169,
        name: "竹林丘陵",
        category: "jungle",
        temperature: .95,
        precipitation: "rain",
        depth: .45,
        rgb: [59, 71, 10],
        dimension: dimensions.Overworld
      });
      register({
        id: 170,
        key: "soul_sand_valley",
        name: "灵魂沙峡谷",
        category: "nether",
        temperature: 2,
        precipitation: "none",
        depth: .1,
        rgb: [94, 56, 48],
        climates: [{
          temperature: 0,
          humidity: -.5,
          altitude: 0,
          weirdness: 0,
          offset: 0
        }],
        dimension: dimensions.Nether
      });
      register({
        id: 171,
        key: "crimson_forest",
        name: "绯红森林",
        category: "nether",
        temperature: 2,
        precipitation: "none",
        depth: .1,
        rgb: [221, 8, 8],
        climates: [{
          temperature: .4,
          humidity: 0,
          altitude: 0,
          weirdness: 0,
          offset: 0
        }],
        dimension: dimensions.Nether
      });
      register({
        id: 172,
        key: "warped_forest",
        name: "诡异森林",
        category: "nether",
        temperature: 2,
        precipitation: "none",
        depth: .1,
        rgb: [73, 144, 123],
        climates: [{
          temperature: 0,
          humidity: .5,
          altitude: 0,
          weirdness: 0,
          offset: .375
        }],
        dimension: dimensions.Nether
      });
      register({
        id: 173,
        key: "basalt_deltas",
        name: "玄武岩三角洲",
        category: "nether",
        temperature: 2,
        precipitation: "none",
        depth: .1,
        rgb: [64, 54, 54],
        climates: [{
          temperature: -.5,
          humidity: 0,
          altitude: 0,
          weirdness: 0,
          offset: .175
        }],
        dimension: dimensions.Nether
      });
      register({
        id: 174,
        key: "dripstone_caves",
        name: "溶洞",
        category: "none",
        temperature: .8,
        precipitation: "rain",
        depth: 0,
        rgb: [193, 165, 143],
        dimension: dimensions.Overworld
      });
      register({
        id: 175,
        key: "lush_caves",
        name: "繁茂洞穴",
        category: "none",
        temperature: .5,
        precipitation: "rain",
        depth: 0,
        rgb: [223, 150, 52],
        dimension: dimensions.Overworld
      });
      register({
        id: 177,
        key: "meadow",
        name: "草甸",
        category: "mountain",
        temperature: .5,
        precipitation: "rain",
        depth: 0,
        rgb: [140, 164, 112],
        dimension: dimensions.Overworld
      });
      register({
        id: 178,
        key: "grove",
        name: "雪林",
        category: "forest",
        temperature: -.2,
        precipitation: "snow",
        depth: 0,
        rgb: [223, 236, 229],
        dimension: dimensions.Overworld
      });
      register({
        id: 179,
        key: "snowy_slopes",
        name: "积雪山坡",
        category: "mountain",
        temperature: -.3,
        precipitation: "snow",
        depth: 0,
        rgb: [218, 241, 241],
        dimension: dimensions.Overworld
      });
      register({
        id: 180,
        key: "frozen_peaks",
        name: "冰封山峰",
        category: "mountain",
        temperature: -.7,
        precipitation: "snow",
        depth: 0,
        rgb: [234, 251, 251],
        dimension: dimensions.Overworld
      });
      register({
        id: 181,
        key: "jagged_peaks",
        name: "尖峭山峰",
        category: "mountain",
        temperature: -.7,
        precipitation: "snow",
        depth: 0,
        rgb: [227, 236, 237],
        dimension: dimensions.Overworld
      });
      register({
        id: 182,
        key: "stony_peaks",
        name: "裸岩山峰",
        category: "mountain",
        temperature: 1,
        precipitation: "rain",
        depth: 0,
        rgb: [209, 209, 209],
        dimension: dimensions.Overworld
      });
      register({
        id: 183,
        key: "deep_dark",
        name: "深暗之域",
        category: "none",
        temperature: .8,
        precipitation: "rain",
        depth: 0,
        rgb: [0, 0, 0],
        dimension: dimensions.Overworld
      });
      register({
        id: 184,
        key: "mangrove_swamp",
        name: "红树林沼泽",
        category: "none",
        temperature: .8,
        precipitation: "rain",
        depth: 0,
        rgb: [36, 196, 142],
        dimension: dimensions.Overworld
      });
      register({
        id: 185,
        key: "cherry_grove",
        name: "樱花树林",
        category: "mountain",
        temperature: 0,
        precipitation: "none",
        depth: 0,
        rgb: [247, 185, 220],
        dimension: dimensions.Overworld
      });
      register({
        id: 186,
        key: "pale_garden",
        name: "苍白花园",
        category: "forest",
        temperature: .7,
        precipitation: "none",
        depth: 0,
        rgb: [108, 111, 150],
        dimension: dimensions.Overworld,
        displayCategory: "woodlands"
      });
      register({
        id: 187,
        key: "sulfur_caves",
        name: "硫黄洞穴",
        category: "none",
        temperature: .8,
        precipitation: "none",
        depth: 0,
        rgb: [200, 200, 40],
        dimension: dimensions.Overworld,
        displayCategory: "caves"
      });
      register({
        id: 188,
        key: "dappled_forest",
        name: "斑驳森林",
        category: "forest",
        temperature: .6,
        precipitation: "none",
        depth: 0,
        rgb: [154, 63, 53],
        dimension: dimensions.Overworld,
        displayCategory: "woodlands"
      });
    }();
    return d
  }()
});
